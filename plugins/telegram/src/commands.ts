import type { PluginCommandDefinition } from "@marswave/cola-plugin-sdk";
import { readTelegramConfig, redactToken } from "./config.js";
import type { TelegramGatewayState } from "./gateway.js";

export function createTelegramCommands(
  getState: () => TelegramGatewayState,
): PluginCommandDefinition[] {
  return [
    {
      name: "telegram",
      aliases: ["tg"],
      description: "Telegram plugin status and configuration summary",
      args: [{ name: "subcommand", description: '"status" or "config"', required: false }],
      async execute(ctx) {
        const subcommand = ctx.args.trim() || "status";
        const state = getState();

        if (subcommand === "status") {
          const bot = state.me?.username ? `@${state.me.username}` : (state.me?.first_name ?? "-");
          const status = state.connected ? "connected" : "disconnected";
          const lastUpdate = state.lastUpdateAt
            ? new Date(state.lastUpdateAt).toISOString()
            : "never";
          return {
            reply: [
              "**Telegram Status**",
              "",
              `- status: ${status}`,
              `- bot: ${bot}`,
              `- last update: ${lastUpdate}`,
              state.lastError ? `- last error: ${state.lastError}` : undefined,
            ]
              .filter((line): line is string => Boolean(line))
              .join("\n"),
          };
        }

        if (subcommand === "config") {
          const config = readTelegramConfig(ctx.config);
          return {
            reply: [
              "**Telegram Config**",
              "",
              `- bot token: ${redactToken(config.botToken)}`,
              `- polling timeout: ${config.pollingTimeoutSeconds}s`,
              `- allowed chats: ${config.allowedChatIds.size || "(missing)"}`,
              `- drop pending updates: ${config.dropPendingUpdates}`,
            ].join("\n"),
          };
        }

        return { reply: `Unknown subcommand: ${subcommand}. Use "status" or "config".` };
      },
    },
  ];
}
