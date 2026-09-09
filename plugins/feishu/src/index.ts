import { pluginMessage as m } from "@marswave/cola-plugin-sdk";
import { defineChannel } from "@marswave/cola-plugin-sdk";
import type {
  GatewayContext,
  OutboundContext,
  ReactionContext,
  DeliveryContext,
  ChannelStatusResult,
} from "@marswave/cola-plugin-sdk";
import type { FeishuPluginConfig } from "./api/types.js";
import { setPluginDir, resolvePluginDir, parseAccountConfigs } from "./auth/accounts.js";
import { migrateLegacyAllowlist } from "./auth/legacy-allowlist.js";
import { createFeishuAuth } from "./auth/login.js";
import { startMonitor, type MonitorHandle } from "./gateway/monitor.js";
import { sendText, sendMedia, sendReaction } from "./outbound/send.js";
import { createFeishuCommands } from "./commands/feishu.js";
import { clearClientCache } from "./api/client.js";
import { describeConnectionError } from "./gateway/connection-error.js";

type FeishuGatewayState = {
  monitors: Map<string, MonitorHandle>;
  failures: Map<string, string>;
};

// Module-level monitor registry — populated by gateway.start, read by outbound/tools
let activeMonitors = new Map<string, MonitorHandle>();
let activeFailures = new Map<string, string>();

function getAccountStatus(
  accountId: string,
  monitors?: Map<string, MonitorHandle>,
  failures?: Map<string, string>,
): ChannelStatusResult {
  const monitor = monitors?.get(accountId);
  if (monitor) return monitor.getStatus();
  const details = failures?.get(accountId);
  return {
    connected: false,
    configured: true,
    message: details
      ? m("status.failed", "Connection failed")
      : m("status.disconnected", "Disconnected"),
    details,
  };
}

function trimRecipientPrefix(to: string): string {
  const separator = to.indexOf(":");
  return separator >= 0 ? to.slice(separator + 1) : to;
}

function resolveMonitorForDelivery(deliveryContext: DeliveryContext): MonitorHandle | undefined {
  if (deliveryContext.accountId) {
    const monitor = activeMonitors.get(deliveryContext.accountId);
    if (monitor) return monitor;
  }

  const recipient = trimRecipientPrefix(deliveryContext.to);
  for (const handle of activeMonitors.values()) {
    if (handle.chatMap.hasUser(recipient)) return handle;
  }

  // Fallback: return first available monitor (single-account scenario)
  const first = activeMonitors.values().next();
  return first.done ? undefined : first.value;
}

export default defineChannel<FeishuGatewayState>({
  id: "feishu",

  meta: {
    label: "Feishu",
    description: "Feishu/Lark messaging via official bot API",
    markdownCapable: true,
  },

  unauthorizedHint(target) {
    return target.kind === "group"
      ? m(
          "auth.group",
          "This group is not authorized. Ask an administrator to run:\n```\ncola channel allow-group {{plugin}} {{id}}\n```",
          { plugin: "feishu", id: target.id },
        )
      : m(
          "auth.user",
          "Access is not authorized. Ask an administrator to run:\n```\ncola channel allow {{plugin}} {{id}}\n```",
          { plugin: "feishu", id: target.id },
        );
  },
  capabilities: {
    receive: {
      text: true,
      image: true,
      file: true,
      reaction: true,
    },
    send: {
      text: true,
      image: true,
      file: true,
      markdown: true,
      reaction: true,
    },
    limits: {
      maxTextLength: 30000,
    },
  },

  config: {
    schema: {
      fields: [
        {
          key: "appId",
          path: ["accounts", "default", "appId"],
          label: m("config.appId", "App ID"),
          type: "text",
          required: true,
          placeholder: "cli_xxx",
        },
        {
          key: "appSecret",
          path: ["accounts", "default", "appSecret"],
          label: m("config.appSecret", "App Secret"),
          type: "password",
          required: true,
          secret: true,
        },
        {
          key: "domain",
          path: ["accounts", "default", "domain"],
          label: m("config.domain", "Domain"),
          type: "select",
          defaultValue: "feishu",
          options: [
            { label: m("label", "Feishu"), value: "feishu" },
            { label: "Lark", value: "lark" },
          ],
        },
        // `groupEnabled` is intentionally not exposed in the config UI: group chat
        // stays disabled (gateway reads `config.groupEnabled ?? false`). The field
        // remains in FeishuPluginConfig and can be flipped via channels.json if needed.
      ],
    },
  },

  auth: createFeishuAuth(),

  commands: createFeishuCommands((id) => getAccountStatus(id, activeMonitors, activeFailures)),

  gateway: {
    async start(ctx: GatewayContext<FeishuGatewayState>) {
      const config = ctx.config as unknown as FeishuPluginConfig;
      const dir = resolvePluginDir(config);
      setPluginDir(dir);

      const monitors = new Map<string, MonitorHandle>();
      ctx.state.monitors = monitors;
      const failures = new Map<string, string>();
      ctx.state.failures = failures;
      activeMonitors = monitors;
      activeFailures = failures;

      // One-time migration: move any legacy authorizedOpenIds into SDK identity
      // bindings so previously-authorized users keep access under the access gate.
      // Reads the raw config (not parseAccountConfigs) so disabled / not-yet-credentialed
      // accounts still have their legacy allowlist migrated.
      await migrateLegacyAllowlist(
        Object.values(config.accounts ?? {}),
        ctx.runtime.identity,
        ctx.logger,
      );

      const accounts = parseAccountConfigs(config);
      if (accounts.size === 0) {
        ctx.logger.warn("No Feishu accounts configured");
        return;
      }

      const groupEnabled = config.groupEnabled ?? false;

      for (const [accountId, acctConfig] of accounts) {
        try {
          const handle = await startMonitor({
            i18n: ctx.runtime.i18n,
            accountId,
            config: acctConfig,
            deliver: ctx.deliver,
            logger: ctx.logger,
            abortSignal: ctx.abortSignal,
            groupEnabled,
          });
          if (ctx.abortSignal.aborted || ctx.state.monitors !== monitors) {
            handle.cleanup();
            break;
          }
          monitors.set(accountId, handle);
        } catch (err) {
          if (ctx.abortSignal.aborted || ctx.state.monitors !== monitors) break;
          const details = describeConnectionError(err);
          failures.set(accountId, details);
          ctx.logger.error(`Failed to start monitor for account ${accountId}: ${details}`);
        }
      }

      ctx.logger.info(`Feishu gateway started with ${monitors.size} account(s)`);
    },

    async stop(ctx: GatewayContext<FeishuGatewayState>) {
      const monitors = ctx.state.monitors;
      if (!monitors) return;

      for (const [id, handle] of monitors) {
        ctx.logger.info(`Stopping feishu account ${id}`);
        handle.cleanup();
      }
      monitors.clear();
      ctx.state.monitors = new Map();
      ctx.state.failures?.clear();
      activeMonitors = new Map();
      activeFailures = new Map();
      clearClientCache();
    },

    async reload(ctx: GatewayContext<FeishuGatewayState>) {
      await this.stop!(ctx);
      await this.start(ctx);
    },

    getStatus(ctx: GatewayContext<FeishuGatewayState>): ChannelStatusResult {
      const accounts = parseAccountConfigs(ctx.config as unknown as FeishuPluginConfig);
      if (accounts.size === 0) {
        return {
          connected: false,
          configured: false,
          message: m("status.noAccounts", "No accounts configured"),
        };
      }
      const statuses = [...accounts.keys()].map((id) => ({
        id,
        status: getAccountStatus(id, ctx.state.monitors, ctx.state.failures),
      }));
      const connectedCount = statuses.filter(({ status }) => status.connected).length;
      const details =
        statuses
          .filter(({ status }) => status.details)
          .map(({ id, status }) => `${id}: ${status.details}`)
          .join("\n") || undefined;
      return {
        connected: connectedCount > 0,
        configured: true,
        message:
          connectedCount > 0
            ? m("status.accounts", "Connected accounts: {{count}}", { count: connectedCount })
            : (statuses.find(({ status }) => status.details) ?? statuses[0]).status.message,
        details,
      };
    },
  },

  outbound: {
    mediaCapabilities: {
      // Feishu im API caps: files <= 30MB (im/v1/files); images <= 10MB
      // (im/v1/images) are enforced server-side and surface as a failure notice.
      maxBytesPerFile: 30 * 1024 * 1024,
      maxBytesTotal: 90 * 1024 * 1024,
    },

    async sendText(ctx: OutboundContext) {
      const handle = resolveMonitorForDelivery(ctx.deliveryContext);
      if (!handle) {
        ctx.logger.error("sendText: no active Feishu account");
        return;
      }
      await sendText(handle.client, ctx.deliveryContext.to, ctx.text, handle.chatMap, ctx.logger);
    },

    async sendMedia(ctx: OutboundContext & { mediaType: string; filePath: string }) {
      const handle = resolveMonitorForDelivery(ctx.deliveryContext);
      if (!handle) {
        ctx.logger.error("sendMedia: no active Feishu account");
        return;
      }
      await sendMedia(
        handle.client,
        ctx.deliveryContext.to,
        ctx.mediaType,
        ctx.filePath,
        handle.chatMap,
        ctx.logger,
      );
    },

    async sendReaction(ctx: ReactionContext) {
      const handle = resolveMonitorForDelivery(ctx.deliveryContext);
      if (!handle) {
        ctx.logger.error("sendReaction: no active Feishu account");
        return;
      }
      await sendReaction(
        handle.client,
        ctx.messageId,
        ctx.emoji,
        ctx.action,
        ctx.reactionId,
        ctx.logger,
      );
    },
  },
});
