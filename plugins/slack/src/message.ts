import type { DeliverPayload, SessionId } from "@marswave/cola-plugin-sdk";
import type { SlackMessageEvent } from "./types.js";

type InboundConversation = NonNullable<DeliverPayload["conversation"]>;

/** Message subtypes that still carry user content worth delivering. */
const ALLOWED_SUBTYPES = new Set(["file_share", "thread_broadcast"]);

export type ParsedSlackMessage = {
  sessionId: SessionId;
  senderId: string;
  conversation: InboundConversation;
  mentionedBot?: boolean;
  deliveryTo: string;
  threadId?: string;
  messageId: string;
  text: string;
};

export function isDirectMessage(event: SlackMessageEvent): boolean {
  if (event.channel_type === "im") return true;
  if (event.channel_type === "mpim" || event.channel_type === "channel") return false;
  return event.channel.startsWith("D");
}

export function shouldSkipSubtype(event: SlackMessageEvent): boolean {
  return event.subtype !== undefined && !ALLOWED_SUBTYPES.has(event.subtype);
}

export function isFromBot(event: SlackMessageEvent, botUserId: string | undefined): boolean {
  if (event.bot_id) return true;
  return botUserId !== undefined && event.user === botUserId;
}

export function isBotMentioned(event: SlackMessageEvent, botUserId: string | undefined): boolean {
  if (!botUserId) return false;
  return (event.text ?? "").includes(`<@${botUserId}>`);
}

export function parseSlackMessage(
  event: SlackMessageEvent,
  accountId: string,
  botUserId: string | undefined,
): ParsedSlackMessage | undefined {
  const senderId = event.user;
  if (!senderId) return undefined;

  const text = extractMessageText(event, botUserId);
  if (!text.trim() && !event.files?.length) return undefined;

  const isDm = isDirectMessage(event);
  const channelId = event.channel;
  const conversation = resolveConversation(event, isDm, senderId);

  // Channel messages always reply in the message's thread (the top-level
  // message starts one); DMs only thread when the user already did.
  const threadId = isDm ? event.thread_ts : (event.thread_ts ?? event.ts);
  const threadSuffix = !isDm && threadId ? ["thread", threadId] : [];

  return {
    sessionId: isDm
      ? ["chat", accountId, channelId, "sender", senderId]
      : ["chat", accountId, channelId, ...threadSuffix],
    senderId,
    conversation,
    mentionedBot: isDm ? undefined : isBotMentioned(event, botUserId),
    deliveryTo: `channel:${channelId}`,
    threadId,
    messageId: event.ts,
    text,
  };
}

export function extractChannelId(deliveryTo: string): string {
  return deliveryTo.startsWith("channel:") ? deliveryTo.slice("channel:".length) : deliveryTo;
}

function resolveConversation(
  event: SlackMessageEvent,
  isDm: boolean,
  senderId: string,
): InboundConversation {
  if (event.channel_type === "im") return { kind: "direct", id: senderId };
  if (event.channel_type === "mpim" || event.channel_type === "group") {
    return { kind: "group", id: event.channel };
  }
  if (isDm) return { kind: "direct", id: senderId };
  return { kind: "channel", id: event.channel };
}

function extractMessageText(event: SlackMessageEvent, botUserId: string | undefined): string {
  let text = event.text ?? "";
  if (botUserId) {
    text = text.replaceAll(`<@${botUserId}>`, "").trim();
  }
  text = decodeSlackEntities(text);

  if (!text && event.files?.length) {
    return event.files
      .map((file) => `[Slack file: ${file.name ?? file.title ?? file.id}]`)
      .join("\n");
  }
  return text;
}

/** Convert Slack message entities (<@U…>, <#C…|name>, <url|label>) to plain text. */
function decodeSlackEntities(text: string): string {
  return text
    .replace(/<@([A-Z0-9]+)>/g, "@$1")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<([^>]+)>/g, "$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
