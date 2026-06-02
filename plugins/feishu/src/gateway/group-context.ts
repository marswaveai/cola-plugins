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
    const parsed = JSON.parse(content) as { content?: unknown; title?: unknown };
    const segments: string[] = [];
    if (typeof parsed.title === "string" && parsed.title.trim()) segments.push(parsed.title);
    if (Array.isArray(parsed.content)) {
      for (const node of parsed.content.flat()) {
        if (node && typeof node === "object" && "text" in node && typeof node.text === "string") {
          segments.push(node.text);
        }
      }
    }
    const text = normalizeWhitespace(segments.join(" "));
    return text || "[富文本]";
  } catch {
    return "[富文本]";
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}
