import { pluginMessage as m } from "@marswave/cola-plugin-sdk";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type { ChannelSender, ChannelStatusResult, GatewayContext } from "@marswave/cola-plugin-sdk";
import { isSlackConfigured, readSlackConfig, type SlackConfig } from "./config.js";
import { downloadSlackFile } from "./media.js";
import {
  isBotMentioned,
  isDirectMessage,
  isFromBot,
  parseSlackMessage,
  shouldSkipSubtype,
} from "./message.js";
import type { SlackMessageEvent, SlackUserProfile } from "./types.js";

export type SlackGatewayState = {
  socket?: SocketModeClient;
  web?: WebClient;
  botUserId?: string;
  botName?: string;
  teamId?: string;
  configured?: boolean;
  connected?: boolean;
  startedAt?: number;
  lastEventAt?: number;
  lastError?: string;
  allowedIds?: string[];
};

type SlackEventArgs = {
  event: SlackMessageEvent;
  ack: () => Promise<void>;
};

/** Socket Mode redelivers events after reconnects; remember recent ones. */
class EventDedup {
  private seen = new Set<string>();
  private order: string[] = [];

  isDuplicate(key: string): boolean {
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    this.order.push(key);
    if (this.order.length > 1000) {
      const oldest = this.order.shift();
      if (oldest) this.seen.delete(oldest);
    }
    return false;
  }
}

export async function startGateway(ctx: GatewayContext<SlackGatewayState>): Promise<void> {
  const config = readSlackConfig(ctx.config);
  resetState(ctx.state);
  ctx.state.configured = isSlackConfigured(config);
  ctx.state.allowedIds = [...config.allowedIds];

  if (!ctx.state.configured) {
    ctx.logger.warn("Slack bot token, app token, and allowed IDs are required");
    return;
  }

  try {
    const web = new WebClient(config.botToken);
    const auth = await web.auth.test();
    ctx.state.web = web;
    ctx.state.botUserId = typeof auth.user_id === "string" ? auth.user_id : undefined;
    ctx.state.botName = typeof auth.user === "string" ? auth.user : undefined;
    ctx.state.teamId = typeof auth.team_id === "string" ? auth.team_id : undefined;
    ctx.state.startedAt = Date.now();

    const socket = new SocketModeClient({ appToken: config.appToken });
    ctx.state.socket = socket;

    const dedup = new EventDedup();
    const senderCache = new Map<string, ChannelSender>();

    const handle = async ({ event, ack }: SlackEventArgs) => {
      await ack();
      try {
        await handleSlackEvent(event, ctx, config, dedup, senderCache);
      } catch (err) {
        ctx.logger.warn("Failed to handle Slack event", err);
      }
    };

    // A channel @mention produces both a `message` and an `app_mention` event;
    // dedup by channel:ts collapses them.
    socket.on("message", handle);
    socket.on("app_mention", handle);

    socket.on("connected", () => {
      ctx.state.connected = true;
      ctx.state.lastError = undefined;
    });
    socket.on("disconnected", () => {
      ctx.state.connected = false;
    });
    socket.on("error", (error: unknown) => {
      ctx.state.lastError = errorMessage(error);
      ctx.logger.warn("Slack socket error", error);
    });

    ctx.abortSignal.addEventListener("abort", () => void socket.disconnect(), { once: true });

    await socket.start();
    ctx.state.connected = true;
    ctx.state.lastError = undefined;
    ctx.logger.info(
      `Slack gateway connected as @${ctx.state.botName ?? "?"} (${ctx.state.botUserId ?? "?"}) in team ${ctx.state.teamId ?? "?"}`,
    );
  } catch (err) {
    ctx.state.connected = false;
    ctx.state.lastError = errorMessage(err);
    ctx.logger.warn("Failed to start Slack gateway", err);
    throw err;
  }
}

export async function stopGateway(ctx: GatewayContext<SlackGatewayState>): Promise<void> {
  const socket = ctx.state.socket;
  ctx.state.socket = undefined;
  ctx.state.web = undefined;
  ctx.state.connected = false;
  if (socket) {
    try {
      await socket.disconnect();
    } catch (err) {
      ctx.logger.warn("Failed to disconnect Slack socket", err);
    }
  }
}

export function getGatewayStatus(ctx: GatewayContext<SlackGatewayState>): ChannelStatusResult {
  if (!ctx.state.configured) {
    return {
      connected: false,
      configured: false,
      message: m("config.requiredSlack", "Bot token, app token, and allowed IDs are required."),
    };
  }
  if (!ctx.state.connected) {
    return {
      connected: false,
      configured: true,
      message: m("status.disconnected", "Disconnected"),
      details: ctx.state.lastError,
    };
  }

  const bot = ctx.state.botName ? `@${ctx.state.botName}` : ctx.state.botUserId;
  return {
    connected: true,
    configured: true,
    message: m("status.gateway", "{{mode}} \u00b7 {{bot}} \u00b7 Allowed: {{count}}", {
      mode: "Socket Mode",
      bot: bot ?? "—",
      count: ctx.state.allowedIds?.length ?? 0,
    }),
  };
}

async function handleSlackEvent(
  event: SlackMessageEvent,
  ctx: GatewayContext<SlackGatewayState>,
  config: SlackConfig,
  dedup: EventDedup,
  senderCache: Map<string, ChannelSender>,
): Promise<void> {
  if (!event.channel || !event.ts) return;
  if (dedup.isDuplicate(`${event.channel}:${event.ts}`)) return;
  if (shouldSkipSubtype(event)) return;
  if (config.ignoreBotMessages && isFromBot(event, ctx.state.botUserId)) return;

  const isDm = isDirectMessage(event);
  const allowed = isDm
    ? (event.user !== undefined && config.allowedIds.has(event.user)) ||
      config.allowedIds.has(event.channel)
    : config.allowedIds.has(event.channel);

  if (!allowed) {
    // Reply with the IDs needed for the allowlist: always in DMs, only on an
    // explicit @mention in channels (anything else would spam the channel).
    if (isDm || isBotMentioned(event, ctx.state.botUserId)) {
      ctx.logger.info(`Skipping Slack message from unlisted ${isDm ? "user" : "channel"}`);
      await sendAccessNotConfiguredReply(event, ctx);
    }
    return;
  }

  const accountId = ctx.state.teamId ?? "default";
  const parsed = parseSlackMessage(event, accountId, ctx.state.botUserId);
  if (!parsed) return;

  ctx.state.lastEventAt = Date.now();

  const attachments: string[] = [];
  for (const file of event.files ?? []) {
    const filePath = await downloadSlackFile(file, config.botToken, ctx.logger);
    if (filePath) attachments.push(filePath);
  }

  // The configured allowlist is this channel's authorization gate, so bind the
  // sender to the primary Cola user on first contact. Without a binding the host
  // drops every message as an "unbound sender" and the bot never replies.
  if (!(await ctx.runtime.identity.resolve(parsed.senderId))) {
    await ctx.runtime.identity.bind(parsed.senderId);
    ctx.logger.info(`Bound Slack sender ${parsed.senderId} from allowed ${event.channel}`);
  }

  await ctx.deliver({
    sessionId: parsed.sessionId,
    sender: await resolveSender(parsed.senderId, ctx, senderCache),
    conversation: parsed.conversation,
    mentionedBot: parsed.mentionedBot,
    deliveryContext: {
      to: parsed.deliveryTo,
      accountId,
      threadId: parsed.threadId,
      messageId: parsed.messageId,
    },
    message: parsed.text,
    attachments: attachments.length > 0 ? attachments : undefined,
  });
}

async function resolveSender(
  userId: string,
  ctx: GatewayContext<SlackGatewayState>,
  cache: Map<string, ChannelSender>,
): Promise<ChannelSender> {
  const cached = cache.get(userId);
  if (cached) return cached;

  let sender: ChannelSender = { id: userId };
  try {
    const result = await ctx.state.web?.users.info({ user: userId });
    const user = result?.user as SlackUserProfile | undefined;
    if (user) {
      sender = {
        id: userId,
        name: user.profile?.display_name || user.profile?.real_name || user.real_name || user.name,
        handle: user.name ? `@${user.name}` : undefined,
        avatarUrl: user.profile?.image_72,
      };
    }
  } catch {
    // users:read scope may be missing; fall back to the bare ID.
  }
  cache.set(userId, sender);
  return sender;
}

async function sendAccessNotConfiguredReply(
  event: SlackMessageEvent,
  ctx: GatewayContext<SlackGatewayState>,
): Promise<void> {
  if (!ctx.state.web) return;
  try {
    await ctx.state.web.chat.postMessage({
      channel: event.channel,
      text: await ctx.runtime.i18n!.text(accessNotConfiguredMessage(event)),
      ...(event.thread_ts ? { thread_ts: event.thread_ts } : {}),
    });
  } catch (err) {
    ctx.logger.warn(`Failed to send Slack access notice for ${event.channel}`, err);
  }
}

function accessNotConfiguredMessage(event: SlackMessageEvent) {
  return m(
    "slack.access",
    "Slack access is not configured.\nUser ID: {{user}}\nChat ID: {{chat}}",
    { user: event.user ?? "—", chat: event.channel },
  );
}

function resetState(state: SlackGatewayState): void {
  state.socket = undefined;
  state.web = undefined;
  state.botUserId = undefined;
  state.botName = undefined;
  state.teamId = undefined;
  state.configured = false;
  state.connected = false;
  state.startedAt = undefined;
  state.lastEventAt = undefined;
  state.lastError = undefined;
  state.allowedIds = undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
