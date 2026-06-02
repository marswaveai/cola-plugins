import type * as lark from "@larksuiteoapi/node-sdk";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import type { FeishuPostContent, FeishuPostElement } from "../api/types.js";

export const MAX_CONTEXT_MESSAGES = 50;

const PER_LINE_MAX = 300;
const CONTEXT_HEADER =
  "[Recent group messages since your last reply — context only, not all directed at you]";
const CURRENT_HEADER = "[Current message — reply to this]";

export type GroupContextItem = {
  message_id?: string;
  msg_type?: string;
  create_time?: string;
  sender?: { id?: string; sender_type?: string };
  body?: { content?: string };
};

/** Per-monitor in-memory watermark of the last group message we handled per chat. */
export class GroupContextTracker {
  private readonly watermarks = new Map<string, number>();

  get(chatId: string): number | undefined {
    return this.watermarks.get(chatId);
  }

  set(chatId: string, createTimeMs: number): void {
    this.watermarks.set(chatId, createTimeMs);
  }
}

export function buildGroupContextBlock(
  items: GroupContextItem[],
  opts: { triggerMessageId: string; maxLines?: number },
): string | undefined {
  const maxLines = opts.maxLines ?? MAX_CONTEXT_MESSAGES;
  const lines: string[] = [];
  for (const item of items) {
    if (item.message_id && item.message_id === opts.triggerMessageId) continue;
    if (item.sender?.sender_type !== "user") continue;
    const text = renderLineText(item.msg_type, item.body?.content);
    if (!text) continue;
    const sender = item.sender?.id ?? "unknown";
    lines.push(`[${sender}] ${truncate(text, PER_LINE_MAX)}`);
  }
  const kept = lines.slice(-maxLines);
  if (kept.length === 0) return undefined;
  return `${CONTEXT_HEADER}\n${kept.join("\n")}`;
}

export async function fetchGroupContext(opts: {
  client: lark.Client;
  logger: PluginLogger;
  chatId: string;
  triggerMessageId: string;
  triggerCreateTimeMs: number;
  startTimeMs?: number;
  maxMessages?: number;
}): Promise<string | undefined> {
  const { client, logger, chatId, triggerMessageId, triggerCreateTimeMs, startTimeMs } = opts;
  const maxMessages = opts.maxMessages ?? MAX_CONTEXT_MESSAGES;
  const hasStart = typeof startTimeMs === "number";
  try {
    const params = {
      container_id_type: "chat" as const,
      container_id: chatId,
      page_size: maxMessages,
      end_time: String(Math.floor(triggerCreateTimeMs / 1000)),
      sort_type: (hasStart ? "ByCreateTimeAsc" : "ByCreateTimeDesc") as
        | "ByCreateTimeAsc"
        | "ByCreateTimeDesc",
      ...(startTimeMs !== undefined ? { start_time: String(Math.floor(startTimeMs / 1000)) } : {}),
    };
    const res = await client.im.message.list({ params } as Parameters<
      typeof client.im.message.list
    >[0]);
    let items = (res?.data?.items ?? []) as GroupContextItem[];
    if (!hasStart) items = [...items].reverse();
    return buildGroupContextBlock(items, { triggerMessageId, maxLines: maxMessages });
  } catch (err) {
    logger.warn(`feishu: failed to fetch group context for chat ${chatId}`, err);
    return undefined;
  }
}

export function prependGroupContext(currentText: string, block: string | undefined): string {
  if (!block) return currentText;
  return `${block}\n\n${CURRENT_HEADER}\n${currentText}`;
}

function renderLineText(
  msgType: string | undefined,
  content: string | undefined,
): string | undefined {
  switch (msgType) {
    case "text":
      return extractText(content);
    case "post":
      return extractPostText(content);
    case "image":
      return "[图片]";
    case "media":
      return "[视频]";
    case "audio":
      return "[语音]";
    case "file":
      return "[文件]";
    case "sticker":
      return "[表情]";
    default:
      return msgType ? `[${msgType}]` : undefined;
  }
}

function extractText(content: string | undefined): string | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    if (typeof parsed.text === "string") {
      const t = normalizeWhitespace(parsed.text);
      return t || undefined;
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

function extractPostText(content: string | undefined): string | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as Record<string, FeishuPostContent>;
    // Post content is language-keyed; prefer zh_cn, then en_us, then first available.
    const post = parsed.zh_cn ?? parsed.en_us ?? Object.values(parsed)[0];
    if (!post) return "[富文本]";
    const segments: string[] = [];
    if (typeof post.title === "string" && post.title.trim()) segments.push(post.title);
    for (const paragraph of post.content ?? []) {
      segments.push(paragraph.map(postElementToText).join(""));
    }
    const text = normalizeWhitespace(segments.join(" "));
    return text || "[富文本]";
  } catch {
    return "[富文本]";
  }
}

function postElementToText(elem: FeishuPostElement): string {
  switch (elem.tag) {
    case "text":
      return elem.text;
    case "a":
      return `[${elem.text}](${elem.href})`;
    case "at":
      return `@${elem.user_name ?? elem.user_id}`;
    case "img":
      return "[图片]";
    case "md":
      return elem.text;
    default:
      return "";
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}
