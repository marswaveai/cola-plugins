import type { ChannelSender, SessionId } from "@marswave/cola-plugin-sdk";
import type { TelegramMessage, TelegramUser } from "./types.js";

export type ParsedTelegramMessage = {
  sessionId: SessionId;
  sender: ChannelSender;
  deliveryTo: string;
  threadId?: number;
  messageId: string;
  text: string;
};

export function parseTelegramMessage(
  message: TelegramMessage,
  accountId: string,
): ParsedTelegramMessage | undefined {
  const text = extractMessageText(message);
  if (!text.trim()) return undefined;

  const chatId = String(message.chat.id);
  const sender = resolveSender(message);
  const threadSuffix =
    message.message_thread_id !== undefined ? ["thread", String(message.message_thread_id)] : [];

  return {
    sessionId: ["chat", accountId, chatId, ...threadSuffix, "sender", sender.id],
    sender,
    deliveryTo: `chat:${chatId}`,
    threadId: message.message_thread_id,
    messageId: String(message.message_id),
    text,
  };
}

export function isFromBot(message: TelegramMessage): boolean {
  return message.from?.is_bot === true;
}

export function extractChatId(deliveryTo: string): string {
  return deliveryTo.startsWith("chat:") ? deliveryTo.slice("chat:".length) : deliveryTo;
}

export function extractMessageThreadId(threadId: string | number | undefined): number | undefined {
  if (typeof threadId === "number" && Number.isFinite(threadId)) return Math.trunc(threadId);
  if (typeof threadId !== "string") return undefined;
  const parsed = Number(threadId);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function resolveSender(message: TelegramMessage): ChannelSender {
  if (message.from) {
    return userToSender(message.from);
  }

  if (message.sender_chat) {
    return {
      id: `chat:${message.sender_chat.id}`,
      name: message.sender_chat.title ?? message.sender_chat.first_name,
      handle: message.sender_chat.username ? `@${message.sender_chat.username}` : undefined,
    };
  }

  return { id: `chat:${message.chat.id}`, name: message.chat.title ?? message.chat.first_name };
}

function userToSender(user: TelegramUser): ChannelSender {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return {
    id: String(user.id),
    name: name || user.username,
    handle: user.username ? `@${user.username}` : undefined,
  };
}

function extractMessageText(message: TelegramMessage): string {
  if (typeof message.text === "string") return message.text;
  if (typeof message.caption === "string") return message.caption;
  if (message.photo) return "[Telegram photo]";
  if (message.document) return `[Telegram document: ${message.document.file_name ?? "file"}]`;
  if (message.audio)
    return `[Telegram audio: ${message.audio.title ?? message.audio.file_name ?? "audio"}]`;
  if (message.voice) return "[Telegram voice message]";
  if (message.video) return `[Telegram video: ${message.video.file_name ?? "video"}]`;
  if (message.sticker)
    return `[Telegram sticker${message.sticker.emoji ? ` ${message.sticker.emoji}` : ""}]`;
  if (message.location) {
    return `[Telegram location: ${message.location.latitude}, ${message.location.longitude}]`;
  }
  return "";
}
