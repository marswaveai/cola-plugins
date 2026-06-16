import type { PluginCommandDefinition } from "@marswave/cola-plugin-sdk";
import { readSlackConfig, redactToken } from "./config.js";
import type { SlackGatewayState } from "./gateway.js";

export function createSlackCommands(getState: () => SlackGatewayState): PluginCommandDefinition[] {
  return [
    {
      name: "slack",
      description: "Slack plugin status and configuration summary",
      args: [{ name: "subcommand", description: '"status" or "config"', required: false }],
      async execute(ctx) {
        const subcommand = ctx.args.trim() || "status";
        const state = getState();

        if (subcommand === "status") {
          const bot = state.botName ? `@${state.botName}` : (state.botUserId ?? "-");
          const status = state.connected ? "connected" : "disconnected";
          const lastEvent = state.lastEventAt ? new Date(state.lastEventAt).toISOString() : "never";
          return {
            reply: [
              "**Slack Status**",
              "",
              `- status: ${status}`,
              `- bot: ${bot}`,
              `- team: ${state.teamId ?? "-"}`,
              `- last event: ${lastEvent}`,
              state.lastError ? `- last error: ${state.lastError}` : undefined,
            ]
              .filter((line): line is string => Boolean(line))
              .join("\n"),
          };
        }

        if (subcommand === "config") {
          const config = readSlackConfig(ctx.config);
          return {
            reply: [
              "**Slack Config**",
              "",
              `- bot token: ${redactToken(config.botToken)}`,
              `- app token: ${redactToken(config.appToken)}`,
              `- allowed ids: ${config.allowedIds.size || "(missing)"}`,
              `- ignore bot messages: ${config.ignoreBotMessages}`,
            ].join("\n"),
          };
        }

        return { reply: `Unknown subcommand: ${subcommand}. Use "status" or "config".` };
      },
    },
  ];
}
