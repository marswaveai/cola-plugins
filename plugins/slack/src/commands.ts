import { pluginMessage as m, joinPluginText as join } from "@marswave/cola-plugin-sdk";
import type { PluginCommandDefinition, PluginText } from "@marswave/cola-plugin-sdk";
import { readSlackConfig, redactToken } from "./config.js";
import type { SlackGatewayState } from "./gateway.js";
export function createSlackCommands(getState: () => SlackGatewayState): PluginCommandDefinition[] {
  return [
    {
      name: "slack",

      description: m("command.description", "{{name}} status and configuration", {
        name: m("label", "Slack"),
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
          const bot = state.botName ? `@${state.botName}` : (state.botUserId ?? "—");
          const status = state.connected
            ? m("status.connected", "Connected")
            : m("status.disconnected", "Disconnected");
          const time = state.lastEventAt;
          const lines: PluginText[] = [
            m("command.statusTitle", "**{{name}} Status**", { name: m("label", "Slack") }),
            "",
            m("command.statusLine", "- Status: {{status}}", { status }),
            m("command.botLine", "- Bot: {{bot}}", { bot }),
            m("command.eventLine", "- Last activity: {{time}}", {
              time: time ? new Date(time).toISOString() : m("state.never", "Never"),
            }),
          ];
          lines.push(m("command.teamLine", "- Team: {{team}}", { team: state.teamId ?? "—" }));
          if (state.lastError)
            lines.push(
              m("command.errorLine", "- Error details: {{error}}", { error: state.lastError }),
            );
          return { reply: join(lines) };
        }
        if (subcommand === "config") {
          const config = readSlackConfig(ctx.config);
          return {
            reply: join([
              m("command.configTitle", "**{{name}} Configuration**", { name: m("label", "Slack") }),
              "",
              m("command.tokenLine", "- Bot token: {{token}}", {
                token: config.botToken
                  ? redactToken(config.botToken)
                  : m("state.missing", "Missing"),
              }),
              m("command.allowedLine", "- Allowed IDs: {{count}}", {
                count: config.allowedIds.size || m("state.missing", "Missing"),
              }),
              m("command.appTokenLine", "- App token: {{token}}", {
                token: config.appToken
                  ? redactToken(config.appToken)
                  : m("state.missing", "Missing"),
              }),
              m("command.ignoreLine", "- Ignore bot messages: {{value}}", {
                value: config.ignoreBotMessages ? m("state.yes", "Yes") : m("state.no", "No"),
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
