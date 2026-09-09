import { describe, expect, it, vi } from "vitest";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import type { SlackGatewayState } from "../src/gateway.js";
import { sendSlackDraft, type SlackDraftContext } from "../src/outbound.js";

const logger: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("slack draft streaming", () => {
  it("coalesces concurrent first draft updates for the same prompt", async () => {
    const postMessage = vi.fn(async () => ({ channel: "C123", ts: "1710000000.000100" }));
    const update = vi.fn(async () => ({}));
    const deleteMessage = vi.fn(async () => ({}));
    const state = {
      web: {
        chat: {
          postMessage,
          update,
          delete: deleteMessage,
        },
      },
    } as unknown as SlackGatewayState;

    await Promise.all([
      sendSlackDraft(makeDraftContext("first"), state),
      sendSlackDraft(makeDraftContext("second"), state),
    ]);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      channel: "C123",
      ts: "1710000000.000100",
      text: "second",
    });

    await sendSlackDraft(makeDraftContext("", true), state);
  });
});

function makeDraftContext(text: string, done = false): SlackDraftContext {
  return {
    deliveryContext: {
      channel: "slack",
      to: "channel:C123",
      threadId: "1710000000.000100",
      messageId: "1710000000.000000",
    },
    text,
    done,
    promptId: "prompt-race",
    config: { botToken: "xoxb-token", unfurlLinks: false },
    logger,
  };
}
