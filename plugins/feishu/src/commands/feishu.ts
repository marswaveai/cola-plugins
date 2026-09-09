import { pluginMessage as m, joinPluginText as join } from "@marswave/cola-plugin-sdk";
import type { PluginText, PluginCommandDefinition } from "@marswave/cola-plugin-sdk";
import type { MonitorHandle } from "../gateway/monitor.js";
import { redactSecret } from "../util/redact.js";

export function createFeishuCommands(
  getMonitors: () => Map<string, MonitorHandle>,
): PluginCommandDefinition[] {
  return [
    {
      name: "feishu",
      aliases: ["fs", "lark"],
      description: m("command.description", "{{name}} status and configuration", {
        name: m("label", "Feishu"),
      }),
      args: [
        {
          name: "subcommand",
          description: m("command.args", "Subcommand: {{commands}}", {
            commands: "status | accounts",
          }),
          required: false,
        },
      ],
      async execute(ctx) {
        const sub = ctx.args.trim() || "status";
        const monitors = getMonitors();

        if (sub === "status") {
          if (monitors.size === 0) {
            return { reply: m("status.noAccounts", "No accounts configured") };
          }
          const lines: PluginText[] = [
            m("command.statusTitle", "**{{name}} Status**", { name: m("label", "Feishu") }),
            "",
          ];
          for (const [id] of monitors) {
            lines.push(
              m("", "- **{{id}}**: {{status}}", { id, status: m("status.connected", "Connected") }),
            );
          }
          return { reply: join(lines) };
        }

        if (sub === "accounts") {
          const accounts = (ctx.config.accounts ?? {}) as Record<string, Record<string, unknown>>;
          if (Object.keys(accounts).length === 0) {
            return { reply: m("status.noAccounts", "No accounts configured") };
          }
          const lines: PluginText[] = [
            m("command.configTitle", "**{{name}} Configuration**", { name: m("label", "Feishu") }),
            "",
          ];
          for (const [id, acct] of Object.entries(accounts)) {
            const appId =
              typeof acct.appId === "string"
                ? redactSecret(acct.appId)
                : m("state.missing", "Missing");
            const domain = (acct.domain as string) ?? "feishu";
            const active = monitors.has(id)
              ? m("status.connected", "Connected")
              : m("status.disconnected", "Disconnected");
            lines.push(
              m(
                "command.accountLine",
                "- **{{id}}**: App ID={{appId}}, domain={{domain}}, {{status}}",
                { id, appId, domain, status: active },
              ),
            );
          }
          return { reply: join(lines) };
        }

        return {
          reply: m("command.unknown", "Unknown subcommand: {{subcommand}}. Use {{commands}}.", {
            subcommand: sub,
            commands: "status | accounts",
          }),
        };
      },
    },
  ];
}
