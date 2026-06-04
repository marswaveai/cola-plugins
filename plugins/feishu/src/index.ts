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

type FeishuGatewayState = {
  monitors: Map<string, MonitorHandle>;
};

// Module-level monitor registry — populated by gateway.start, read by outbound/tools
let activeMonitors = new Map<string, MonitorHandle>();

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
          label: "App ID",
          type: "text",
          required: true,
          placeholder: "cli_xxx",
        },
        {
          key: "appSecret",
          path: ["accounts", "default", "appSecret"],
          label: "App Secret",
          type: "password",
          required: true,
          secret: true,
        },
        {
          key: "domain",
          path: ["accounts", "default", "domain"],
          label: "Domain",
          type: "select",
          defaultValue: "feishu",
          options: [
            { label: "Feishu", value: "feishu" },
            { label: "Lark", value: "lark" },
          ],
        },
        {
          key: "groupEnabled",
          path: ["groupEnabled"],
          label: "启用群聊",
          description:
            "关闭时，群里 @机器人只会收到「暂不支持群聊」提示。开启后需对每个群单独授信。",
          type: "boolean",
          defaultValue: false,
        },
      ],
    },
  },

  unauthorizedHint(target) {
    if (target.kind === "group") {
      return [
        "这个群还没有被授信，无法使用 Cola。",
        "请管理员执行：",
        "```",
        `cola channel allow-group feishu ${target.id}`,
        "```",
      ].join("\n");
    }
    return [
      "你还没有被授信，无法使用 Cola。",
      "请管理员执行：",
      "```",
      `cola channel allow feishu ${target.id}`,
      "```",
    ].join("\n");
  },

  auth: createFeishuAuth(),

  commands: createFeishuCommands(() => activeMonitors),

  gateway: {
    async start(ctx: GatewayContext<FeishuGatewayState>) {
      const config = ctx.config as unknown as FeishuPluginConfig;
      const dir = resolvePluginDir(config);
      setPluginDir(dir);

      const monitors = new Map<string, MonitorHandle>();
      ctx.state.monitors = monitors;

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
            accountId,
            config: acctConfig,
            deliver: ctx.deliver,
            logger: ctx.logger,
            abortSignal: ctx.abortSignal,
            groupEnabled,
          });
          monitors.set(accountId, handle);
        } catch (err) {
          ctx.logger.error(`Failed to start monitor for account ${accountId}`, err);
        }
      }

      // Update module-level reference
      activeMonitors = monitors;

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
      activeMonitors = new Map();
      clearClientCache();
    },

    async reload(ctx: GatewayContext<FeishuGatewayState>) {
      await this.stop!(ctx);
      await this.start(ctx);
    },

    getStatus(ctx: GatewayContext<FeishuGatewayState>): ChannelStatusResult {
      const monitors = ctx.state.monitors;
      if (!monitors || monitors.size === 0) {
        return { connected: false, configured: false, message: "No accounts configured" };
      }
      return {
        connected: true,
        configured: true,
        message: `${monitors.size} account(s) connected`,
      };
    },
  },

  outbound: {
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
