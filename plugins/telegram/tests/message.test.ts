import { describe, expect, it } from "vitest";
import { extractChatId, extractMessageThreadId, parseTelegramMessage } from "../src/message.js";
import type { TelegramMessage } from "../src/types.js";

describe("telegram message parsing", () => {
  it("creates a stable session and delivery target for text messages", () => {
    const message: TelegramMessage = {
      message_id: 42,
      message_thread_id: 7,
      chat: { id: -100123, type: "supergroup", title: "Team" },
      date: 1,
      from: {
        id: 99,
        is_bot: false,
        first_name: "Ada",
        last_name: "Lovelace",
        username: "ada",
      },
      text: "hello",
    };

    const parsed = parseTelegramMessage(message, "123456");

    expect(parsed).toEqual({
      sessionId: ["chat", "123456", "-100123", "thread", "7", "sender", "99"],
      sender: { id: "99", name: "Ada Lovelace", handle: "@ada" },
      deliveryTo: "chat:-100123",
      threadId: 7,
      messageId: "42",
      text: "hello",
    });
  });

  it("summarizes supported non-text messages", () => {
    const message: TelegramMessage = {
      message_id: 3,
      chat: { id: 123, type: "private" },
      date: 1,
      photo: [{}],
    };

    expect(parseTelegramMessage(message, "bot")?.text).toBe("[Telegram photo]");
  });

  it("normalizes delivery context helpers", () => {
    expect(extractChatId("chat:-100123")).toBe("-100123");
    expect(extractChatId("123")).toBe("123");
    expect(extractMessageThreadId("7")).toBe(7);
    expect(extractMessageThreadId("not-a-number")).toBeUndefined();
  });
});
