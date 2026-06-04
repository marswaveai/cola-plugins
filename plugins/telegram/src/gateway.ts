import { createPollLoop } from "@marswave/cola-plugin-sdk";
import type { ChannelStatusResult, GatewayContext } from "@marswave/cola-plugin-sdk";
import { TelegramApiClient } from "./api.js";
import { isTelegramConfigured, readTelegramConfig, type TelegramConfig } from "./config.js";
import { isFromBot, parseTelegramMessage } from "./message.js";
import type { TelegramMessage, TelegramUpdate, TelegramUser } from "./types.js";

/** Reply sent to a group @mention/reply while group chat is disabled. */
const GROUP_DISABLED_NOTICE = "暂不支持群聊";

export type TelegramGatewayState = {
  abortController?: AbortController;
  client?: TelegramApiClient;
  me?: TelegramUser;
  configured?: boolean;
  connected?: boolean;
  nextOffset?: number;
  startedAt?: number;
  lastUpdateAt?: number;
  lastError?: string;
  allowedChatIds?: string[];
};

export async function startGateway(ctx: GatewayContext<TelegramGatewayState>): Promise<void> {
  const config = readTelegramConfig(ctx.config);
  resetState(ctx.state);
  ctx.state.configured = isTelegramConfigured(config);
  ctx.state.allowedChatIds = [...config.allowedChatIds];

  if (!ctx.state.configured) {
    ctx.logger.warn("Telegram bot token and allowed chat IDs are required");
    return;
  }

  const abortController = new AbortController();
  const signal = mergeAbortSignals(ctx.abortSignal, abortController.signal);
  const client = new TelegramApiClient({
    botToken: config.botToken,
  });

  ctx.state.abortController = abortController;
  ctx.state.client = client;
  ctx.state.startedAt = Date.now();

  const me = await client.getMe(signal);
  await client.deleteWebhook(config.dropPendingUpdates, signal);

  ctx.state.me = me;
  ctx.state.connected = true;
  ctx.state.lastError = undefined;

  createPollLoop<TelegramUpdate>({
    signal,
    intervalMs: config.pollIntervalMs,
    getDelayMs: (lastError) =>
      lastError ? Math.max(1000, config.pollIntervalMs) : config.pollIntervalMs,
    fetch: async (pollSignal) => {
      const updates = await client.getUpdates(
        ctx.state.nextOffset,
        config.pollingTimeoutSeconds,
        pollSignal,
      );
      ctx.state.connected = true;
      ctx.state.lastError = undefined;
      return updates;
    },
    onMessages: async (updates) => {
      for (const update of updates) {
        await handleUpdate(update, ctx, config);
        ctx.state.nextOffset = update.update_id + 1;
        ctx.state.lastUpdateAt = Date.now();
      }
    },
    onError: (error) => {
      ctx.state.connected = false;
      ctx.state.lastError = error.message;
      ctx.logger.warn("Telegram polling failed", error);
    },
  });

  ctx.logger.info(`Telegram gateway started as @${me.username ?? me.first_name} (${me.id})`);
}

export function stopGateway(ctx: GatewayContext<TelegramGatewayState>): void {
  ctx.state.abortController?.abort();
  ctx.state.abortController = undefined;
  ctx.state.connected = false;
  ctx.state.client = undefined;
}

export function getGatewayStatus(ctx: GatewayContext<TelegramGatewayState>): ChannelStatusResult {
  if (!ctx.state.configured) {
    return {
      connected: false,
      configured: false,
      message: "Bot token and allowed chat IDs are required",
    };
  }
  if (!ctx.state.connected) {
    return {
      connected: false,
      configured: true,
      message: ctx.state.lastError ? `Disconnected: ${ctx.state.lastError}` : "Disconnected",
    };
  }

  const bot = ctx.state.me?.username ? `@${ctx.state.me.username}` : ctx.state.me?.first_name;
  const allowed =
    ctx.state.allowedChatIds && ctx.state.allowedChatIds.length > 0
      ? `; allowed chats=${ctx.state.allowedChatIds.length}`
      : "";
  return {
    connected: true,
    configured: true,
    message: `Polling${bot ? ` as ${bot}` : ""}${allowed}`,
  };
}

export async function handleUpdate(
  update: TelegramUpdate,
  ctx: GatewayContext<TelegramGatewayState>,
  config: TelegramConfig,
): Promise<void> {
  const message =
    update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!message) return;

  const chatId = String(message.chat.id);
  if (config.ignoreBotMessages && isFromBot(message)) return;

  // Group chat is opt-in. While disabled, reply "not supported" to a direct
  // @mention / reply-to-bot and ignore all other non-private messages.
  if (message.chat.type !== "private" && !config.groupEnabled) {
    if (isBotAddressed(message, ctx.state.me)) {
      await sendGroupDisabledReply(message, ctx, config);
    }
    return;
  }

  if (config.allowedChatIds.size > 0 && !config.allowedChatIds.has(chatId)) {
    ctx.logger.info(`Skipping Telegram message from unlisted chat ${chatId}`);
    await sendAccessNotConfiguredReply(message, ctx, config);
    return;
  }

  const accountId = ctx.state.me ? String(ctx.state.me.id) : "default";
  const parsed = parseTelegramMessage(message, accountId);
  if (!parsed) return;

  // The configured allowlist is this channel's authorization gate, so bind the
  // sender to the primary Cola user on first contact. Without a binding the host
  // drops every message as an "unbound sender" and the bot never replies.
  if (!(await ctx.runtime.identity.resolve(parsed.sender.id))) {
    await ctx.runtime.identity.bind(parsed.sender.id);
    ctx.logger.info(`Bound Telegram sender ${parsed.sender.id} from allowed chat ${chatId}`);
  }

  await ctx.deliver({
    sessionId: parsed.sessionId,
    sender: parsed.sender,
    deliveryContext: {
      to: parsed.deliveryTo,
      accountId,
      threadId: parsed.threadId,
      messageId: parsed.messageId,
    },
    message: parsed.text,
  });
}

async function sendAccessNotConfiguredReply(
  message: NonNullable<TelegramUpdate["message"]>,
  ctx: GatewayContext<TelegramGatewayState>,
  config: TelegramConfig,
): Promise<void> {
  if (!config.botToken) return;

  const client = ctx.state.client ?? new TelegramApiClient({ botToken: config.botToken });
  try {
    await client.sendMessage({
      chatId: String(message.chat.id),
      messageThreadId: message.message_thread_id,
      text: accessNotConfiguredMessage(message),
    });
  } catch (err) {
    ctx.logger.warn(`Failed to send Telegram access notice for chat ${message.chat.id}`, err);
  }
}

async function sendGroupDisabledReply(
  message: NonNullable<TelegramUpdate["message"]>,
  ctx: GatewayContext<TelegramGatewayState>,
  config: TelegramConfig,
): Promise<void> {
  if (!config.botToken) return;

  const client = ctx.state.client ?? new TelegramApiClient({ botToken: config.botToken });
  try {
    await client.sendMessage({
      chatId: String(message.chat.id),
      messageThreadId: message.message_thread_id,
      text: GROUP_DISABLED_NOTICE,
    });
  } catch (err) {
    ctx.logger.warn(
      `Failed to send Telegram group-disabled notice for chat ${message.chat.id}`,
      err,
    );
  }
}

/** True when the message @mentions the bot or replies to one of the bot's messages. */
function isBotAddressed(message: TelegramMessage, me: TelegramUser | undefined): boolean {
  if (!me) return false;
  if (message.reply_to_message?.from?.id === me.id) return true;

  const username = me.username?.toLowerCase();
  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities ?? [];
  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user?.id === me.id) return true;
    if (entity.type === "mention" && username) {
      const mention = text.slice(entity.offset, entity.offset + entity.length).toLowerCase();
      if (mention === `@${username}`) return true;
    }
  }
  return false;
}

function accessNotConfiguredMessage(message: NonNullable<TelegramUpdate["message"]>): string {
  const userId = message.from ? String(message.from.id) : undefined;
  const chatId = String(message.chat.id);
  const lines = ["Cola Telegram: access not configured.", ""];

  if (userId) {
    lines.push("Your Telegram user id:", "```", userId, "```", "");
  }

  lines.push("Your Telegram chat id:", "```", chatId, "```");

  return lines.join("\n");
}

function resetState(state: TelegramGatewayState): void {
  state.abortController?.abort();
  state.abortController = undefined;
  state.client = undefined;
  state.me = undefined;
  state.configured = false;
  state.connected = false;
  state.nextOffset = undefined;
  state.startedAt = undefined;
  state.lastUpdateAt = undefined;
  state.lastError = undefined;
  state.allowedChatIds = undefined;
}

function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }

  return controller.signal;
}
