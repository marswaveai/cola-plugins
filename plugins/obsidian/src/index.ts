import { defineChannel } from "@marswave/cola-plugin-sdk";
import type { ChannelStatusResult, OutboundContext } from "@marswave/cola-plugin-sdk";
import { startLocalServer, stopLocalServer, getServerStatus } from "./gateway.js";
import { sendReplyToClient } from "./outbound.js";
import type { ObsidianState } from "./types.js";

export default defineChannel<ObsidianState>({
  id: "obsidian",

  meta: {
    label: "Obsidian",
    description: "Chat with Cola inside Obsidian with full vault context",
    markdownCapable: true,
  },

  capabilities: {
    receive: { text: true },
    send: { text: true, markdown: true },
    limits: { maxTextLength: 50000 },
  },

  config: {
    schema: {
      fields: [
        {
          key: "port",
          label: "本地端口",
          description: "一般不需要修改。仅当 19533 端口被占用时才需要更改。",
          type: "number",
          required: false,
          defaultValue: 19533,
        },
      ],
    },
  },

  gateway: {
    async start(ctx) {
      ctx.state.connections = new Map();
      await startLocalServer(ctx);
      ctx.logger.info("Obsidian gateway started");
    },

    async stop(ctx) {
      await stopLocalServer(ctx);
      ctx.state.connections.clear();
      ctx.logger.info("Obsidian gateway stopped");
    },

    async reload(ctx) {
      await stopLocalServer(ctx);
      ctx.state.connections = new Map();
      await startLocalServer(ctx);
      ctx.logger.info("Obsidian gateway reloaded");
    },

    getStatus(ctx): ChannelStatusResult {
      return getServerStatus(ctx);
    },
  },

  outbound: {
    async sendText(ctx: OutboundContext) {
      await sendReplyToClient(ctx);
    },
  },
});
