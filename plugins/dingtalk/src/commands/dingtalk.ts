import { pluginMessage as m, joinPluginText as join } from "@marswave/cola-plugin-sdk";
import type {
  ChannelStatusResult,
  PluginText,
  PluginCommandDefinition,
} from "@marswave/cola-plugin-sdk";
import type { DingTalkPluginConfig } from "../api/types.js";
import { parseAccountConfigs } from "../auth/accounts.js";
import { redactSecret } from "../util/redact.js";

export function createDingTalkCommands(
  getAccountStatus: (accountId: string) => ChannelStatusResult,
): PluginCommandDefinition[] {
  return [
    {
      name: "dingtalk",
      aliases: ["dt"],
      description: m("command.description", "{{name}} status and configuration", {
        name: m("label", "DingTalk"),
      }),
      args: [
        {
          name: "subcommand",
          description: m("command.args", "Subcommands: {{commands}}", {
            commands: "status | accounts",
          }),
          required: false,
        },
      ],
      async execute(ctx) {
        const sub = ctx.args.trim() || "status";
        const accounts = parseAccountConfigs(ctx.config as unknown as DingTalkPluginConfig);

        if (sub === "status") {
          if (accounts.size === 0) {
            return { reply: m("status.noAccounts", "No account configured") };
          }
          const lines: PluginText[] = [
            m("command.statusTitle", "**{{name}} Status**", { name: m("label", "DingTalk") }),
            "",
          ];
          for (const [id] of accounts) {
            const status = getAccountStatus(id);
            lines.push(
              m("", "- **{{id}}**: {{status}}", {
                id,
                status: status.message ?? m("status.disconnected", "Disconnected"),
              }),
            );
            if (status.details) lines.push(status.details);
          }
          return { reply: join(lines) };
        }

        if (sub === "accounts") {
          const accounts = (ctx.config.accounts ?? {}) as Record<string, Record<string, unknown>>;
          if (Object.keys(accounts).length === 0) {
            return { reply: m("status.noAccounts", "No account configured") };
          }
          const lines: PluginText[] = [
            m("command.configTitle", "**{{name}} Configuration**", {
              name: m("label", "DingTalk"),
            }),
            "",
          ];
          for (const [id, acct] of Object.entries(accounts)) {
            const clientId =
              typeof acct.clientId === "string"
                ? redactSecret(acct.clientId)
                : m("state.missing", "Missing");
            const active = getAccountStatus(id).message ?? m("status.disconnected", "Disconnected");
            lines.push(
              m("command.accountLine", "- **{{id}}**: Client ID={{clientId}}, {{status}}", {
                id,
                clientId,
                status: active,
              }),
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
