import { defineChannel } from "@marswave/cola-plugin-sdk";
import type { OutboundContext, ChannelStatusResult } from "@marswave/cola-plugin-sdk";
import { readConfig } from "./config";
import {
  gatewayState,
  scheduleFlush,
  startGateway,
  stopGateway,
  type StackChanState,
} from "./gateway/server";
import { createStackchanCommands } from "./commands/stackchan";
import { createOutboundSender } from "./outbound/send";
import { synthesize } from "./outbound/tts-client";

export default defineChannel<StackChanState>({
  id: "stackchan",
  meta: {
    label: "StackChan",
    description: "M5Stack StackChan voice channel over WebSocket",
    markdownCapable: false,
  },
  capabilities: {
    receive: { text: true, voice: true },
    send: { text: true, voice: true, typing: true },
    limits: { maxTextLength: 4000 },
  },
  config: {
    schema: {
      fields: [
        { key: "host", label: "Host", type: "text", defaultValue: "0.0.0.0" },
        { key: "port", label: "Port", type: "number", defaultValue: 19540 },
        { key: "path", label: "Path", type: "text", defaultValue: "/stackchan" },
        { key: "requireToken", label: "Require token", type: "boolean", defaultValue: false },
        { key: "token", label: "Shared token", type: "password", secret: true },
        {
          key: "accessToken",
          label: "Marswave access token",
          type: "password",
          secret: true,
          description: "Used for the listenhub /tts endpoint.",
        },
        { key: "speakerId", label: "TTS speaker id", type: "text" },
        {
          key: "language",
          label: "ASR / TTS language",
          type: "select",
          defaultValue: "auto",
          options: [
            { label: "Auto", value: "auto" },
            { label: "中文", value: "zh" },
            { label: "English", value: "en" },
            { label: "日本語", value: "ja" },
            { label: "한국어", value: "ko" },
          ],
        },
      ],
    },
  },
  commands: createStackchanCommands(
    () => gatewayState.registry,
    () => gatewayState.statusMessage,
  ),
  gateway: {
    async start(ctx) {
      await startGateway(ctx, readConfig(ctx.config));
    },
    async stop(ctx) {
      stopGateway(ctx.state);
    },
    async reload(ctx) {
      stopGateway(ctx.state);
      await startGateway(ctx, readConfig(ctx.config));
    },
    getStatus(_ctx): ChannelStatusResult {
      const list = gatewayState.registry?.list() ?? [];
      return {
        connected: list.length > 0,
        configured: gatewayState.server !== null,
        message: `${gatewayState.statusMessage}; devices=${list.length}`,
      };
    },
  },
  outbound: {
    textChunkLimit: 1000,
    async sendText(ctx: OutboundContext) {
      const deviceId = ctx.deliveryContext.to;
      ctx.logger.info(
        `sendText ENTRY promptId=${ctx.promptId} deviceId=${deviceId} text="${ctx.text.slice(0, 60)}${ctx.text.length > 60 ? "…" : ""}" deliveryContext=${JSON.stringify(ctx.deliveryContext)}`,
      );
      const device = gatewayState.registry?.find(deviceId);
      if (!device) {
        ctx.logger.warn(`no device for outbound text: ${deviceId}`);
        return;
      }
      const config = readConfig(ctx.config);
      let sender = gatewayState.senders.get(ctx.promptId);
      if (!sender) {
        sender = createOutboundSender({
          socket: device.socket,
          promptId: ctx.promptId,
          synth: async (text) => {
            // Prefer Cola-host-provided TTS (uses the user's logged-in
            // Marswave access token; no plugin-config credentials needed).
            if (gatewayState.hostTtsSynthesize) {
              const lang =
                config.language === "zh" || config.language === "en" ? config.language : undefined;
              const buf = await gatewayState.hostTtsSynthesize(
                text,
                lang ? { language: lang } : undefined,
              );
              if (buf) return { audio: buf, format: "wav" };
              // null → fall through to plugin-config path
            }
            // Fallback: plugin-config accessToken (legacy path)
            if (!config.accessToken) {
              throw new Error("accessToken not configured (host TTS also unavailable)");
            }
            const audio = await synthesize({
              baseUrl: config.ttsBaseUrl,
              accessToken: config.accessToken,
              speakerId: config.speakerId || "default",
              language: config.language,
              text,
            });
            return { audio, format: "mp3" };
          },
        });
        gatewayState.senders.set(ctx.promptId, sender);
        let owned = gatewayState.sendersByDevice.get(deviceId);
        if (!owned) {
          owned = new Set();
          gatewayState.sendersByDevice.set(deviceId, owned);
        }
        owned.add(ctx.promptId);
      }
      await sender.sendChunk(ctx.text);
      scheduleFlush(gatewayState, ctx.promptId, deviceId);
    },
  },
});
