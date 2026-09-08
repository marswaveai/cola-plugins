import { pluginMessage as m, PluginLocalizedError } from "@marswave/cola-plugin-sdk";
import { WebClient } from "@slack/web-api";
import type { OutboundContext, ReactionContext } from "@marswave/cola-plugin-sdk";
import { readSlackConfig } from "./config.js";
import { formatSlackMrkdwn } from "./format.js";
import { uploadSlackFile } from "./media.js";
import { extractChannelId } from "./message.js";
import type { SlackGatewayState } from "./gateway.js";

/** Common unicode emoji → Slack reaction names. */
const EMOJI_NAMES: Record<string, string> = {
  "👍": "+1",
  "👎": "-1",
  "❤️": "heart",
  "✅": "white_check_mark",
  "❌": "x",
  "👀": "eyes",
  "🎉": "tada",
  "🚀": "rocket",
  "😄": "smile",
  "🙏": "pray",
  "🔥": "fire",
  "⭐": "star",
  "🤔": "thinking_face",
  "⏳": "hourglass_flowing_sand",
};

export async function sendSlackText(ctx: OutboundContext, state: SlackGatewayState): Promise<void> {
  const config = readSlackConfig(ctx.config);
  const client = resolveClient(state, config.botToken);

  await client.chat.postMessage({
    channel: extractChannelId(ctx.deliveryContext.to),
    text: formatSlackMrkdwn(ctx.text),
    unfurl_links: config.unfurlLinks,
    unfurl_media: config.unfurlLinks,
    ...threadTs(ctx.deliveryContext.threadId),
  });
}

/**
 * Keep the draft context local until the SDK exports it.
 */
export type SlackDraftContext = OutboundContext & { done: boolean };

type SlackDraftMessage = { channel: string; ts: string; touchedAt: number };

const MAX_DRAFTS = 100;
const DRAFT_TTL_MS = 30 * 60 * 1000;

/** promptId → placeholder message posted for the streaming draft. */
const drafts = new Map<string, SlackDraftMessage>();
const pendingDrafts = new Map<string, Promise<SlackDraftMessage | undefined>>();

/**
 * Streaming draft preview: post a placeholder on the first update, then edit
 * it in place as the host streams accumulated text. `done: true` replaces the
 * draft with the final text; `done: true` with empty text deletes it
 * (the reply produced no channel text).
 */
export async function sendSlackDraft(
  ctx: SlackDraftContext,
  state: SlackGatewayState,
): Promise<void> {
  const config = readSlackConfig(ctx.config);
  const client = resolveClient(state, config.botToken);
  const channel = extractChannelId(ctx.deliveryContext.to);
  const draft = getDraft(ctx.promptId);

  if (ctx.done && !ctx.text) {
    drafts.delete(ctx.promptId);
    const pending = pendingDrafts.get(ctx.promptId);
    const pendingDraft = pending ? await pending.catch(() => undefined) : undefined;
    const draftToDelete = pendingDraft ?? draft;
    if (draftToDelete)
      await client.chat.delete({ channel: draftToDelete.channel, ts: draftToDelete.ts });
    return;
  }

  const text = formatSlackMrkdwn(ctx.text);

  if (!draft) {
    const pending = pendingDrafts.get(ctx.promptId);
    if (pending) {
      const pendingDraft = await pending;
      if (pendingDraft) {
        await updateDraft(client, ctx.promptId, pendingDraft, text, ctx.done);
        return;
      }
    }

    // Finalize without a live draft (e.g. plugin reloaded mid-stream): throw
    // so the host falls back to sendText instead of losing the reply.
    if (ctx.done) throw new Error("no draft message to finalize");
    await createDraft(client, ctx.promptId, {
      channel,
      text,
      unfurlLinks: config.unfurlLinks,
      threadId: ctx.deliveryContext.threadId,
    });
    return;
  }

  await updateDraft(client, ctx.promptId, draft, text, ctx.done);
}

export async function sendSlackMedia(
  ctx: OutboundContext & { mediaType: string; filePath: string },
  state: SlackGatewayState,
): Promise<void> {
  const config = readSlackConfig(ctx.config);
  const client = resolveClient(state, config.botToken);

  await uploadSlackFile(client, {
    channelId: extractChannelId(ctx.deliveryContext.to),
    filePath: ctx.filePath,
    threadTs: threadTs(ctx.deliveryContext.threadId).thread_ts,
    comment: ctx.text ? formatSlackMrkdwn(ctx.text) : undefined,
  });
}

/** Reaction added to the triggering message while the bot is working. */
const TYPING_REACTION = "eyes";

/**
 * Slack has no typing API for bots. Mimic it the way openclaw/hermes do:
 * `assistant.threads.setStatus` shows a native "is typing…" line under the
 * thread (cleared by setting an empty status), and a 👀 reaction on the
 * triggering message covers non-thread DMs. Both need optional scopes
 * (assistant:write, reactions:write), so failures are swallowed.
 */
export async function sendSlackTyping(
  ctx: OutboundContext & { active: boolean },
  state: SlackGatewayState,
): Promise<void> {
  const config = readSlackConfig(ctx.config);
  const client = resolveClient(state, config.botToken);
  const channel = extractChannelId(ctx.deliveryContext.to);
  const thread = threadTs(ctx.deliveryContext.threadId).thread_ts;
  const messageId = ctx.deliveryContext.messageId;

  if (thread) {
    try {
      await client.assistant.threads.setStatus({
        channel_id: channel,
        thread_ts: thread,
        status: ctx.active ? "is typing..." : "",
      });
    } catch {
      // Needs assistant:write and an assistant-enabled app; best effort only.
    }
  }

  if (messageId) {
    const params = { channel, timestamp: messageId, name: TYPING_REACTION };
    try {
      if (ctx.active) {
        await client.reactions.add(params);
      } else {
        await client.reactions.remove(params);
      }
    } catch {
      // already_reacted / no_reaction races and missing scopes are harmless.
    }
  }
}

export async function sendSlackReaction(
  ctx: ReactionContext,
  state: SlackGatewayState,
): Promise<void> {
  const name = resolveEmojiName(ctx.emoji);
  if (!name) {
    ctx.logger.warn(`Unsupported Slack reaction emoji: ${ctx.emoji}`);
    return;
  }

  const config = readSlackConfig(ctx.config);
  const client = resolveClient(state, config.botToken);
  const params = {
    channel: extractChannelId(ctx.deliveryContext.to),
    timestamp: ctx.messageId,
    name,
  };

  try {
    if (ctx.action === "add") {
      await client.reactions.add(params);
    } else {
      await client.reactions.remove(params);
    }
  } catch (err) {
    // Duplicate add/remove races are harmless.
    const code = (err as { data?: { error?: string } }).data?.error;
    if (code === "already_reacted" || code === "no_reaction") return;
    throw err;
  }
}

export function resolveEmojiName(emoji: string): string | undefined {
  const trimmed = emoji.trim().replace(/^:|:$/g, "");
  if (/^[\w+-]+$/.test(trimmed)) return trimmed;
  return EMOJI_NAMES[trimmed];
}

function resolveClient(state: SlackGatewayState, botToken: string): WebClient {
  if (state.web) return state.web;
  if (!botToken)
    throw new PluginLocalizedError(m("error.botToken", "Bot token is not configured."));
  return new WebClient(botToken);
}

async function createDraft(
  client: WebClient,
  promptId: string,
  opts: {
    channel: string;
    text: string;
    unfurlLinks: boolean;
    threadId: string | number | undefined;
  },
): Promise<SlackDraftMessage | undefined> {
  const pending = (async () => {
    const result = await client.chat.postMessage({
      channel: opts.channel,
      text: opts.text,
      unfurl_links: opts.unfurlLinks,
      unfurl_media: opts.unfurlLinks,
      ...threadTs(opts.threadId),
    });
    if (typeof result.ts !== "string") return undefined;

    const draft = {
      channel: String(result.channel ?? opts.channel),
      ts: result.ts,
      touchedAt: Date.now(),
    };
    rememberDraft(promptId, draft);
    return draft;
  })();
  pendingDrafts.set(promptId, pending);
  try {
    return await pending;
  } finally {
    pendingDrafts.delete(promptId);
  }
}

async function updateDraft(
  client: WebClient,
  promptId: string,
  draft: SlackDraftMessage,
  text: string,
  done: boolean,
): Promise<void> {
  await client.chat.update({ channel: draft.channel, ts: draft.ts, text });
  if (done) {
    drafts.delete(promptId);
    return;
  }
  rememberDraft(promptId, draft);
}

function getDraft(promptId: string): SlackDraftMessage | undefined {
  pruneDrafts();
  const draft = drafts.get(promptId);
  if (!draft) return undefined;
  if (Date.now() - draft.touchedAt > DRAFT_TTL_MS) {
    drafts.delete(promptId);
    return undefined;
  }
  return draft;
}

function rememberDraft(promptId: string, draft: SlackDraftMessage): void {
  draft.touchedAt = Date.now();
  drafts.delete(promptId);
  drafts.set(promptId, draft);
  pruneDrafts();
}

function pruneDrafts(): void {
  const now = Date.now();
  for (const [promptId, draft] of drafts) {
    if (now - draft.touchedAt > DRAFT_TTL_MS) drafts.delete(promptId);
  }
  while (drafts.size > MAX_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (!oldest) break;
    drafts.delete(oldest);
  }
}

function threadTs(threadId: string | number | undefined): { thread_ts?: string } {
  if (threadId === undefined || threadId === "") return {};
  return { thread_ts: String(threadId) };
}
