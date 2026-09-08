import { pluginMessage as m } from "@marswave/cola-plugin-sdk";
import { defineChannel } from "@marswave/cola-plugin-sdk";
import type {
  ChannelOutboundAdapter,
  ChannelStatusResult,
  OutboundContext,
  ReactionContext,
} from "@marswave/cola-plugin-sdk";
import { createSlackCommands } from "./commands.js";
import { getGatewayStatus, startGateway, stopGateway, type SlackGatewayState } from "./gateway.js";
import {
  sendSlackDraft,
  sendSlackMedia,
  sendSlackReaction,
  sendSlackText,
  sendSlackTyping,
  type SlackDraftContext,
} from "./outbound.js";

let activeState: SlackGatewayState = {};

// sendDraft/draftThrottleMs land in SDK 0.0.5 (streaming draft preview); the
// widened type lets this compile against 0.0.3 until the SDK bump. Hosts that
// predate the capability simply never call sendDraft.
const outbound: ChannelOutboundAdapter & {
  sendDraft?(ctx: SlackDraftContext): Promise<void>;
  draftThrottleMs?: number;
} = {
  textChunkLimit: 4000,
  draftThrottleMs: 1000,
  mediaCapabilities: {
    maxBytesPerFile: 100 * 1024 * 1024,
    supportedKinds: ["image", "file", "video", "audio"],
  },
  async sendText(ctx: OutboundContext) {
    await sendSlackText(ctx, activeState);
  },
  async sendDraft(ctx: SlackDraftContext) {
    await sendSlackDraft(ctx, activeState);
  },
  async sendMedia(ctx: OutboundContext & { mediaType: string; filePath: string }) {
    await sendSlackMedia(ctx, activeState);
  },
  async sendReaction(ctx: ReactionContext) {
    await sendSlackReaction(ctx, activeState);
  },
  async sendTyping(ctx: OutboundContext & { active: boolean }) {
    await sendSlackTyping(ctx, activeState);
  },
};

export default defineChannel<SlackGatewayState>({
  id: "slack",
  meta: {
    label: "Slack",
    description: "Slack messaging via Socket Mode",
    markdownCapable: true,
  },
  unauthorizedHint(target) {
    return target.kind === "group"
      ? m(
          "auth.group",
          "This group is not authorized. Ask an administrator to run:\n```\ncola channel allow-group {{plugin}} {{id}}\n```",
          { plugin: "slack", id: target.id },
        )
      : m(
          "auth.user",
          "Access is not authorized. Ask an administrator to run:\n```\ncola channel allow {{plugin}} {{id}}\n```",
          { plugin: "slack", id: target.id },
        );
  },
  capabilities: {
    receive: { text: true, image: true, file: true },
    send: { text: true, markdown: true, image: true, file: true, reaction: true, typing: true },
    limits: { maxTextLength: 40000 },
  },
  config: {
    schema: {
      fields: [
        {
          key: "botToken",
          label: m("config.botToken", "Bot token"),
          type: "password",
          required: true,
          secret: true,
          placeholder: "xoxb-...",
        },
        {
          key: "appToken",
          label: m("config.appToken", "App-level token"),
          type: "password",
          required: true,
          secret: true,
          placeholder: "xapp-...",
          description: m(
            "config.appTokenHelp",
            "App-level token with the connections:write scope (Socket Mode).",
          ),
        },
        {
          key: "allowedIds",
          label: m("config.allowedIds", "Allowed IDs"),
          type: "text",
          placeholder: "U0123ABC,C0456DEF",
          description: m(
            "config.slackHelp",
            "Comma-separated Slack user IDs (DMs) and channel IDs. Leave empty to connect and receive ID setup hints without delivering messages to Cola.",
          ),
        },
        // Only the tokens and allowlist are exposed in the config UI. The
        // remaining options (ignoreBotMessages, unfurlLinks) keep their
        // defaults from readSlackConfig and can be set via channels.json.
      ],
    },
  },
  commands: createSlackCommands(() => activeState),
  gateway: {
    async start(ctx) {
      activeState = ctx.state;
      await startGateway(ctx);
    },
    async stop(ctx) {
      await stopGateway(ctx);
      if (activeState === ctx.state) activeState = {};
    },
    async reload(ctx) {
      await stopGateway(ctx);
      activeState = ctx.state;
      await startGateway(ctx);
    },
    getStatus(ctx): ChannelStatusResult {
      return getGatewayStatus(ctx);
    },
  },
  outbound,
});
