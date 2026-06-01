import type { OutboundContext } from "@marswave/cola-plugin-sdk";
import { TelegramApiClient } from "./api.js";
import { readTelegramConfig } from "./config.js";
import { extractChatId, extractMessageThreadId } from "./message.js";
import type { TelegramGatewayState } from "./gateway.js";

export async function sendTelegramText(
  ctx: OutboundContext,
  state: TelegramGatewayState,
): Promise<void> {
  const config = readTelegramConfig(ctx.config);
  if (!config.botToken) {
    throw new Error("Telegram bot token is not configured");
  }

  const client =
    state.client ??
    new TelegramApiClient({ botToken: config.botToken, apiBaseUrl: config.apiBaseUrl });

  await client.sendMessage({
    chatId: extractChatId(ctx.deliveryContext.to),
    messageThreadId: extractMessageThreadId(ctx.deliveryContext.threadId),
    text: ctx.text,
  });
}

export async function sendTelegramTyping(
  ctx: OutboundContext & { active: boolean },
  state: TelegramGatewayState,
): Promise<void> {
  if (!ctx.active) return;

  const config = readTelegramConfig(ctx.config);
  if (!config.botToken) return;

  const client =
    state.client ??
    new TelegramApiClient({ botToken: config.botToken, apiBaseUrl: config.apiBaseUrl });

  await client.sendChatAction({
    chatId: extractChatId(ctx.deliveryContext.to),
    messageThreadId: extractMessageThreadId(ctx.deliveryContext.threadId),
    action: "typing",
  });
}
