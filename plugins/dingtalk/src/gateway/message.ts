import type { PluginLogger } from "@marswave/cola-plugin-sdk";

export type DingTalkRobotPayload = {
  /** "1" = direct chat, "2" = group chat */
  conversationType?: string;
  conversationId?: string;
  msgId?: string;
  msgtype?: string;
  text?: { content?: string };
  /** Only present when the robot version is published; required for direct-chat replies. */
  senderStaffId?: string;
  /** Sender id that is always present (used as fallback for identification). */
  senderId?: string;
  senderNick?: string;
  robotCode?: string;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
  createAt?: number;
  isAdmin?: boolean;
  [key: string]: unknown;
};

export type ParsedRobotMessage = {
  text: string;
  msgId: string;
  isGroup: boolean;
  conversationId: string;
  /** Staff id of the sender when the robot version is published. */
  senderStaffId?: string;
  /** Always-present sender id (fallback identification). */
  senderId?: string;
  senderNick?: string;
  robotCode?: string;
  /**
   * Present for inbound media messages (file/picture/audio/video) that carry a
   * downloadCode and a file name. The gateway exchanges the downloadCode for a
   * temporary URL via /v1.0/robot/messageFiles/download, then downloads to a
   * local temp path so it can be handed to the agent as an attachment.
   */
  media?: {
    kind: "image" | "audio" | "video" | "file" | "unknown";
    downloadCode?: string;
    fileName?: string;
  };
};

export const GROUP_MENTION_PREFIX = "@机器人";

/**
 * Parse an inbound robot message pushed over the Stream channel
 * (topic /v1.0/im/bot/messages/get). Returns undefined when the payload is
 * unusable (invalid JSON or missing required identifiers).
 */
export function parseRobotMessage(
  raw: string | unknown,
  logger?: PluginLogger,
): ParsedRobotMessage | undefined {
  let payload: DingTalkRobotPayload;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw) as DingTalkRobotPayload;
    } catch (err) {
      logger?.warn(
        `Failed to parse DingTalk robot message: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  } else if (raw && typeof raw === "object") {
    payload = raw as DingTalkRobotPayload;
  } else {
    return undefined;
  }

  const { msgId, conversationId, conversationType } = payload;
  if (!msgId || !conversationId || !conversationType) {
    logger?.warn("DingTalk robot message missing msgId/conversationId/conversationType, skipping");
    return undefined;
  }

  const isGroup = conversationType === "2";
  const content =
    payload.msgtype === "text"
      ? (payload.text?.content ?? "")
      : payload.msgtype === "richText"
        ? summarizeRichText(payload)
        : summarizeMediaMessage(payload);
  const text = isGroup ? stripMentionPrefix(content) : content;

  return {
    text,
    msgId,
    isGroup,
    conversationId,
    senderStaffId: payload.senderStaffId,
    senderId: payload.senderId,
    senderNick: payload.senderNick,
    robotCode: payload.robotCode,
    media: extractMedia(payload),
  };
}

/**
 * Pull the downloadCode + file name (and a normalized media kind) out of a
 * non-text inbound payload. DingTalk nests these under `content` for several
 * types (file, picture, audio, video) and also at the top level for some.
 * Rich-text (`richText`) messages embed pictures inside `content.richText`;
 * the first `picture` node's downloadCode is extracted so the gateway can
 * download the attached image like any other media message.
 */
export function extractMedia(
  payload: DingTalkRobotPayload,
): ParsedRobotMessage["media"] | undefined {
  if (payload.msgtype === "text") return undefined;
  if (payload.msgtype === "richText") return extractRichTextMedia(payload);

  const content = (payload.content ?? {}) as {
    downloadCode?: string;
    fileName?: string;
  };

  const downloadCode = content.downloadCode ?? (payload as { downloadCode?: string }).downloadCode;
  // Only use a real fileName when the message reports one. The downloadCode is
  // a long base64-ish token that must NOT be reused as a file name (it exceeds
  // common filesystem name limits and hashed fallbacks are applied at download
  // time instead when the name is missing).
  const fileName = content.fileName ?? (payload as { fileName?: string }).fileName;

  const kind = mediaKindForMsgType(payload.msgtype);
  return { kind, downloadCode, fileName: normalizeFileName(fileName) };
}

function mediaKindForMsgType(
  msgtype: string | undefined,
): NonNullable<ParsedRobotMessage["media"]>["kind"] {
  switch (msgtype) {
    case "picture":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "file":
      return "file";
    default:
      return "unknown";
  }
}

/** Normalize an inbound file name so the temp download path stays meaningful. */
function normalizeFileName(name: string | undefined): string | undefined {
  if (!name || !name.trim()) return undefined;
  const trimmed = name.trim();
  // DingTalk returns some media download names as a bare id with no extension;
  // keep whatever we have — sanitization happens at write time.
  return trimmed;
}

/**
 * Group messages arrive with a prepended "@机器人 " (or similar @handle)
 * prefix inserted by DingTalk. Strip the leading mention token followed by
 * whitespace (or the end of the message for a bare mention).
 */
export function stripMentionPrefix(text: string): string {
  return text.replace(/^@\S+(?:\s+|$)/, "").trim();
}

/**
 * First-release handling for non-text message types: deliver a text summary
 * instead of downloading media.
 */
export function summarizeMediaMessage(payload: DingTalkRobotPayload): string {
  switch (payload.msgtype) {
    case "picture":
      return "[图片]";
    case "audio":
      return "[语音]";
    case "video":
      return "[视频]";
    case "richText":
      return summarizeRichText(payload);
    case "file": {
      const fileName =
        (typeof payload.fileName === "string" && payload.fileName) ||
        (typeof (payload.content as { fileName?: unknown } | undefined)?.fileName === "string"
          ? (payload.content as { fileName: string }).fileName
          : undefined);
      return fileName ? `[文件: ${fileName}]` : "[文件]";
    }
    case "post":
      return "[富文本]";
    default:
      return `[${payload.msgtype ?? "unknown"}]`;
  }
}

/**
 * Read the `content.richText` array as a list of rich-text nodes. DingTalk
 * nests rich-text payloads under `content.richText` (an array whose elements
 * are either a bare `{ text }` node or a `{ type, downloadCode }` picture
 * node). The legacy `content.richArray` shape is also accepted for backwards
 * compatibility.
 */
export function richTextContent(payload: DingTalkRobotPayload): RichTextNode[] {
  const content = (payload.content ?? {}) as
    | { richText?: unknown; richArray?: unknown }
    | undefined;
  const raw = content?.richText ?? content?.richArray;
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is RichTextNode => !!n && typeof n === "object");
}

/** A single element of a DingTalk `content.richText` array. */
export type RichTextNode = {
  type?: string;
  text?: string;
  downloadCode?: string;
  fileName?: string;
  [key: string]: unknown;
};

/**
 * The user's free text carried by a rich-text message, with every inline
 * `text` node joined in order. Returns undefined when the message is not a
 * richText payload or carries no such nodes.
 */
export function extractRichText(payload: DingTalkRobotPayload): string | undefined {
  if (payload.msgtype !== "richText") return undefined;
  const text = richTextContent(payload)
    .map((n) => n.text)
    .filter((t): t is string => typeof t === "string")
    .join("")
    .trim();
  return text || undefined;
}

/**
 * Build the text summary for a richText message. When the message embeds one
 * or more pictures the `[图文]` marker is prepended to the inline text (a
 * picture message with a caption becomes `[图文] the caption`; a bare picture
 * message becomes just `[图文]`). A picture-less richText message is treated
 * as plain text and returned as-is, with no marker.
 */
export function summarizeRichText(payload: DingTalkRobotPayload): string {
  const inline = extractRichText(payload);
  const hasPicture = richTextContent(payload).some((n) => n?.type === "picture");
  if (!hasPicture) return (inline ?? "").trim();
  return inline ? `[图文] ${inline}` : "[图文]";
}

/**
 * Pull a media object out of a rich-text message. Rich-text can embed multiple
 * pictures (each a `picture` node in `content.richText`); the gateway's
 * download path consumes a single downloadCode at a time, so the first picture
 * node is used and later ones are dropped (a known limitation, consistent with
 * how the existing picture/file/etc. handlers behave).
 */
function extractRichTextMedia(
  payload: DingTalkRobotPayload,
): ParsedRobotMessage["media"] | undefined {
  const pictureNode = richTextContent(payload).find((n) => n?.type === "picture");
  if (!pictureNode) return undefined;
  const downloadCode = pictureNode.downloadCode;
  if (!downloadCode) return undefined;
  // Prefer a real name; when the picture carries none, leave it undefined so the
  // download path builds a safe hashed name instead of reusing the downloadCode.
  const fileName = normalizeFileName(pictureNode.fileName);
  return { kind: "image", downloadCode, fileName };
}

/**
 * Stable delivery targets: direct chat → `staff:<senderStaffId>`,
 * group chat → `conversation:<conversationId>`.
 */
export function buildSessionTarget(parsed: ParsedRobotMessage): string {
  return parsed.isGroup ? `conversation:${parsed.conversationId}` : `staff:${parsed.senderStaffId}`;
}
