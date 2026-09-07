import { pluginMessage as m, joinPluginText as join } from "@marswave/cola-plugin-sdk";
import type { PluginCommandDefinition, PluginText } from "@marswave/cola-plugin-sdk";
import { readTelegramConfig, redactToken } from "./config.js";
import type { TelegramGatewayState } from "./gateway.js";
export function createTelegramCommands(
  getState: () => TelegramGatewayState,
): PluginCommandDefinition[] {
  return [
    {
      name: "telegram",
      aliases: ["tg"],
      description: m("command.description", "{{name}} status and configuration", {
        name: m("label", "Telegram"),
      }),
      args: [
        {
          name: "subcommand",
          description: m("command.args", "Subcommand: {{commands}}", {
            commands: "status | config",
          }),
          required: false,
        },
      ],
      async execute(ctx) {
        const subcommand = ctx.args.trim() || "status";
        const state = getState();
        if (subcommand === "status") {
          const bot = state.me?.username ? `@${state.me.username}` : (state.me?.first_name ?? "—");
          const status = state.connected
            ? m("status.connected", "Connected")
            : m("status.disconnected", "Disconnected");
          const time = state.lastUpdateAt;
          const lines: PluginText[] = [
            m("command.statusTitle", "**{{name}} Status**", { name: m("label", "Telegram") }),
            "",
            m("command.statusLine", "- Status: {{status}}", { status }),
            m("command.botLine", "- Bot: {{bot}}", { bot }),
            m("command.eventLine", "- Last activity: {{time}}", {
              time: time ? new Date(time).toISOString() : m("state.never", "Never"),
            }),
          ];

          if (state.lastError)
            lines.push(
              m("command.errorLine", "- Error details: {{error}}", { error: state.lastError }),
            );
          return { reply: join(lines) };
        }
        if (subcommand === "config") {
          const config = readTelegramConfig(ctx.config);
          return {
            reply: join([
              m("command.configTitle", "**{{name}} Configuration**", {
                name: m("label", "Telegram"),
              }),
              "",
              m("command.tokenLine", "- Bot token: {{token}}", {
                token: config.botToken
                  ? redactToken(config.botToken)
                  : m("state.missing", "Missing"),
              }),
              m("command.allowedLine", "- Allowed IDs: {{count}}", {
                count: config.allowedChatIds.size || m("state.missing", "Missing"),
              }),
              m("command.timeoutLine", "- Polling timeout: {{seconds}} s", {
                seconds: config.pollingTimeoutSeconds,
              }),
              m("command.dropLine", "- Drop pending updates: {{value}}", {
                value: config.dropPendingUpdates ? m("state.yes", "Yes") : m("state.no", "No"),
              }),
            ]),
          };
        }
        return {
          reply: m("command.unknown", "Unknown subcommand: {{subcommand}}. Use {{commands}}.", {
            subcommand,
            commands: "status | config",
          }),
        };
      },
    },
  ];
}
