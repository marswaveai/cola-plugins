import { pluginMessage as m } from "@marswave/cola-plugin-sdk";
import { defineChannel } from "@marswave/cola-plugin-sdk";
import type {
  GatewayContext,
  OutboundContext,
  ChannelStatusResult,
  DeliveryContext,
} from "@marswave/cola-plugin-sdk";
import type { DingTalkPluginConfig } from "./api/types.js";
import { parseAccountConfigs } from "./auth/accounts.js";
import { startMonitor, type MonitorHandle } from "./gateway/monitor.js";
import { sendText, sendMedia } from "./outbound/send.js";
import { createDingTalkCommands } from "./commands/dingtalk.js";
import { clearClientCache } from "./api/client.js";

type DingTalkGatewayState = {
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

function resolveMonitorForDelivery(deliveryContext: DeliveryContext): MonitorHandle | undefined {
  if (deliveryContext.accountId) {
    const monitor = activeMonitors.get(deliveryContext.accountId);
    if (monitor) return monitor;
  }

  // Fallback: return first available monitor (single-account scenario)
  const first = activeMonitors.values().next();
  return first.done ? undefined : first.value;
}

export default defineChannel<DingTalkGatewayState>({
  id: "dingtalk",

  meta: {
    label: "DingTalk",
    description: "DingTalk messaging via official enterprise bot (Stream mode)",
    markdownCapable: true,
  },

  unauthorizedHint(target) {
    // The default dead-end reply leaves the owner no way to authorize this
    // chat: the ID needed for `cola channel allow[-group]` only shows up in
    // host logs. Always include the target ID and the matching command so the
    // rejection doubles as an actionable authorization hint.
    return target.kind === "group"
      ? m(
          "auth.group",
          "I am the owner's work assistant and am unable to process your request for now. This group is not authorized yet (Group ID: {{groupId}}). The owner can run `cola channel allow-group dingtalk {{groupId}}` on the desktop, or send this ID to the assistant via direct message.",
          { groupId: target.id },
        )
      : m(
          "auth.user",
          "I am the owner's work assistant and am unable to process your request for now. You are not authorized yet (Your ID: {{userId}}). The owner can run `cola channel allow dingtalk {{userId}}` on the desktop, or send this ID to the assistant via an authorized channel.",
          { userId: target.id },
        );
  },

  capabilities: {
    receive: {
      text: true,
      // Media download is implemented in the gateway (gateway/media-download.ts);
      // every inbound media type that DingTalk delivers to the robot is accepted.
      image: true,
      voice: true,
      video: true,
      file: true,
    },
    send: {
      text: true,
      markdown: true,
      // Outbound media: the host uploads via sendMedia (outbound/send.ts). Video
      // is intentionally NOT advertised: DingTalk's sampleVideo needs a separate
      // cover-image mediaId that cannot be derived from the single file the host
      // hands us, so enabling it would fail at send time.
      image: true,
      file: true,
    },
    limits: {
      // DingTalk caps robot msgParam at 15000 UTF-8 bytes. CJK text costs up
      // to 3 bytes/char, so the character budget stays well below that.
      maxTextLength: 4000,
    },
  },

  config: {
    schema: {
      fields: [
        {
          key: "clientId",
          path: ["accounts", "default", "clientId"],
          label: m("config.clientId", "Client ID (AppKey)"),
          type: "text",
          required: true,
          placeholder: "dingxxxxxxxx",
        },
        {
          key: "clientSecret",
          path: ["accounts", "default", "clientSecret"],
          label: m("config.clientSecret", "Client Secret (AppSecret)"),
          type: "password",
          required: true,
          secret: true,
        },
        {
          key: "groupEnabled",
          path: ["groupEnabled"],
          label: m("config.groupEnabled", "Enable group chat"),
          type: "boolean",
          defaultValue: false,
        },
        {
          key: "ownerStaffId",
          path: ["ownerStaffId"],
          label: m("config.ownerStaffId", "Owner Staff ID"),
          type: "text",
          required: false,
        },
      ],
    },
  },

  commands: createDingTalkCommands((id) => getAccountStatus(id, activeMonitors, activeFailures)),

  gateway: {
    async start(ctx: GatewayContext<DingTalkGatewayState>) {
      const config = ctx.config as unknown as DingTalkPluginConfig;

      const monitors = new Map<string, MonitorHandle>();
      ctx.state.monitors = monitors;
      const failures = new Map<string, string>();
      ctx.state.failures = failures;
      activeMonitors = monitors;
      activeFailures = failures;

      const accounts = parseAccountConfigs(config);
      if (accounts.size === 0) {
        ctx.logger.warn("No DingTalk accounts configured");
        return;
      }

      const groupEnabled = config.groupEnabled ?? false;
      const ownerStaffId = config.ownerStaffId;

      for (const [accountId, acctConfig] of accounts) {
        try {
          const handle = await startMonitor({
            accountId,
            config: acctConfig,
            deliver: ctx.deliver,
            logger: ctx.logger,
            abortSignal: ctx.abortSignal,
            groupEnabled,
            ownerStaffId,
          });
          if (ctx.abortSignal.aborted || ctx.state.monitors !== monitors) {
            handle.cleanup();
            break;
          }
          monitors.set(accountId, handle);
        } catch (err) {
          if (ctx.abortSignal.aborted || ctx.state.monitors !== monitors) break;
          const details = err instanceof Error ? err.message : String(err);
          failures.set(accountId, details);
          ctx.logger.error(`Failed to start monitor for account ${accountId}: ${details}`);
        }
      }

      ctx.logger.info(`DingTalk gateway started with ${monitors.size} account(s)`);
    },

    async stop(ctx: GatewayContext<DingTalkGatewayState>) {
      const monitors = ctx.state.monitors;
      if (!monitors) return;

      for (const [id, handle] of monitors) {
        ctx.logger.info(`Stopping dingtalk account ${id}`);
        handle.cleanup();
      }
      monitors.clear();
      ctx.state.monitors = new Map();
      ctx.state.failures?.clear();
      activeMonitors = new Map();
      activeFailures = new Map();
      clearClientCache();
    },

    async reload(ctx: GatewayContext<DingTalkGatewayState>) {
      await this.stop!(ctx);
      await this.start(ctx);
    },

    getStatus(ctx: GatewayContext<DingTalkGatewayState>): ChannelStatusResult {
      const accounts = parseAccountConfigs(ctx.config as unknown as DingTalkPluginConfig);
      if (accounts.size === 0) {
        return {
          connected: false,
          configured: false,
          message: m("status.noAccounts", "No account configured"),
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
      // DingTalk caps media upload at 20MB (image/video/file; voice ≤ 2MB).
      // The host enforces this before calling sendMedia so an oversized file
      // fails client-side rather than at the API.
      maxBytesPerFile: 20 * 1024 * 1024,
      supportedKinds: ["image", "file"],
    },

    async sendText(ctx: OutboundContext) {
      const handle = resolveMonitorForDelivery(ctx.deliveryContext);
      if (!handle) {
        ctx.logger.error("sendText: no active DingTalk account");
        return;
      }
      await sendText(
        handle.restClient,
        ctx.deliveryContext.to,
        ctx.text,
        handle.getRobotCode(),
        ctx.logger,
      );
    },

    async sendMedia(ctx: OutboundContext & { mediaType: string; filePath: string }) {
      const handle = resolveMonitorForDelivery(ctx.deliveryContext);
      if (!handle) {
        ctx.logger.error("sendMedia: no active DingTalk account");
        return;
      }
      await sendMedia(
        handle.restClient,
        ctx.deliveryContext.to,
        ctx.mediaType,
        ctx.filePath,
        handle.getRobotCode(),
        ctx.logger,
      );
    },
  },
});
