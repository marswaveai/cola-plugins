import { describe, expect, it, vi } from "vitest";
import type { GatewayContext } from "@marswave/cola-plugin-sdk";
import { readTelegramConfig } from "../src/config.js";
import { handleUpdate, type TelegramGatewayState } from "../src/gateway.js";
import type { TelegramUpdate } from "../src/types.js";

const config = readTelegramConfig({ botToken: "123456:secret", allowedChatIds: "5693819232" });

function makeCtx(resolveImpl: (id: string) => Promise<string | null> = async () => null) {
  const bind = vi.fn(async () => {});
  const resolve = vi.fn(resolveImpl);
  const deliver = vi.fn(async () => {});
  const sendMessage = vi.fn(async () => {});
  const ctx = {
    state: {
      me: { id: 555, is_bot: true, first_name: "Bot", username: "bot" },
      client: { sendMessage },
    },
    runtime: { identity: { resolve, bind, unbind: vi.fn() } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    deliver,
  } as unknown as GatewayContext<TelegramGatewayState>;
  return { ctx, bind, resolve, deliver, sendMessage };
}

function privateUpdate(chatId: number, fromId: number, text = "hi"): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      chat: { id: chatId, type: "private" },
      date: 1,
      from: { id: fromId, is_bot: false, first_name: "Ada", username: "ada" },
      text,
    },
  };
}

describe("telegram gateway identity binding", () => {
  it("binds an unbound sender from an allowed chat before delivering", async () => {
    const { ctx, bind, resolve, deliver } = makeCtx();

    await handleUpdate(privateUpdate(5693819232, 5693819232), ctx, config);

    expect(resolve).toHaveBeenCalledWith("5693819232");
    expect(bind).toHaveBeenCalledWith("5693819232");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("does not rebind an already-bound sender", async () => {
    const { ctx, bind, deliver } = makeCtx(async () => "user-1");

    await handleUpdate(privateUpdate(5693819232, 5693819232), ctx, config);

    expect(bind).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("replies with access instructions for chats outside the allowlist", async () => {
    const { ctx, bind, resolve, deliver, sendMessage } = makeCtx();

    await handleUpdate(privateUpdate(999, 999), ctx, config);

    expect(resolve).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: "999",
      messageThreadId: undefined,
      text: [
        "Cola Telegram: access not configured.",
        "",
        "Your Telegram user id:",
        "```",
        "999",
        "```",
        "",
        "Your Telegram chat id:",
        "```",
        "999",
        "```",
      ].join("\n"),
    });
  });
});
