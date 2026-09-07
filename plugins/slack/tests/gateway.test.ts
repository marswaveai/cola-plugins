import { resolvePluginText } from "@marswave/cola-plugin-sdk";
import zhCN from "../locales/zh-CN.json";
import { describe, expect, it, vi } from "vitest";
import type { GatewayContext } from "@marswave/cola-plugin-sdk";
import { getGatewayStatus, startGateway, type SlackGatewayState } from "../src/gateway.js";

const slackMocks = vi.hoisted(() => ({
  authTest: vi.fn(),
  socketStart: vi.fn(),
  socketDisconnect: vi.fn(),
  socketOn: vi.fn(),
}));

vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(() => ({
    auth: { test: slackMocks.authTest },
  })),
}));

vi.mock("@slack/socket-mode", () => ({
  SocketModeClient: vi.fn(() => ({
    on: slackMocks.socketOn,
    start: slackMocks.socketStart,
    disconnect: slackMocks.socketDisconnect,
  })),
}));

describe("slack gateway startup", () => {
  it("records auth failures in gateway status", async () => {
    slackMocks.authTest.mockRejectedValueOnce(new Error("invalid_auth"));

    const ctx = makeGatewayContext();

    await expect(startGateway(ctx)).rejects.toThrow("invalid_auth");

    expect(ctx.state.lastError).toBe("invalid_auth");
    expect(resolvePluginText(getGatewayStatus(ctx).message, { "zh-CN": zhCN }, "zh-CN")).toBe(
      "未连接",
    );
    expect(getGatewayStatus(ctx)).toMatchObject({
      connected: false,
      configured: true,
    });
  });
});

function makeGatewayContext(): GatewayContext<SlackGatewayState> {
  return {
    config: { botToken: "xoxb-token", appToken: "xapp-token", allowedIds: "C123" },
    state: {},
    abortSignal: new AbortController().signal,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    runtime: { identity: { resolve: vi.fn(), bind: vi.fn(), unbind: vi.fn() } },
    deliver: vi.fn(),
  } as unknown as GatewayContext<SlackGatewayState>;
}
