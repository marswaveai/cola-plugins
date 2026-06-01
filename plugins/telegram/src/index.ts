import { defineChannel } from "@marswave/cola-plugin-sdk";
import type { ChannelStatusResult, OutboundContext } from "@marswave/cola-plugin-sdk";
import { createTelegramCommands } from "./commands.js";
import {
  getGatewayStatus,
  startGateway,
  stopGateway,
  type TelegramGatewayState,
} from "./gateway.js";
import { sendTelegramText, sendTelegramTyping } from "./outbound.js";

let activeState: TelegramGatewayState = {};

export default defineChannel<TelegramGatewayState>({
  id: "telegram",
  meta: {
    label: "Telegram",
    description: "Telegram messaging via Bot API long polling",
    markdownCapable: false,
  },
  capabilities: {
    receive: { text: true },
    send: { text: true, typing: true },
    limits: { maxTextLength: 4096 },
  },
  config: {
    schema: {
      fields: [
        {
          key: "botToken",
          label: "Bot token",
          type: "password",
          required: true,
          secret: true,
          placeholder: "123456:ABC-DEF...",
        },
        {
          key: "apiBaseUrl",
          label: "API base URL",
          type: "text",
          defaultValue: "https://api.telegram.org",
        },
        {
          key: "allowedChatIds",
          label: "Allowed chat IDs",
          type: "text",
          placeholder: "-1001234567890,123456789",
          description: "Comma-separated Telegram chat IDs. Leave empty to accept all chats.",
        },
        {
          key: "pollingTimeoutSeconds",
          label: "Polling timeout",
          type: "number",
          defaultValue: 25,
        },
        {
          key: "dropPendingUpdates",
          label: "Drop pending updates on start",
          type: "boolean",
          defaultValue: false,
        },
        {
          key: "ignoreBotMessages",
          label: "Ignore bot messages",
          type: "boolean",
          defaultValue: true,
        },
      ],
    },
  },
  commands: createTelegramCommands(() => activeState),
  gateway: {
    async start(ctx) {
      activeState = ctx.state;
      await startGateway(ctx);
    },
    async stop(ctx) {
      stopGateway(ctx);
      if (activeState === ctx.state) activeState = {};
    },
    async reload(ctx) {
      stopGateway(ctx);
      activeState = ctx.state;
      await startGateway(ctx);
    },
    getStatus(ctx): ChannelStatusResult {
      return getGatewayStatus(ctx);
    },
  },
  outbound: {
    textChunkLimit: 4000,
    async sendText(ctx: OutboundContext) {
      await sendTelegramText(ctx, activeState);
    },
    async sendTyping(ctx: OutboundContext & { active: boolean }) {
      await sendTelegramTyping(ctx, activeState);
    },
  },
});
