import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePluginText } from "@marswave/cola-plugin-sdk";
import zhCN from "../locales/zh-CN.json";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayContext } from "@marswave/cola-plugin-sdk";
import {
  getGatewayStatus,
  startGateway,
  stopGateway,
  type SlackGatewayState,
} from "../src/gateway.js";
import slack from "../src/index.js";
import type { SlackMessageEvent } from "../src/types.js";

const slackMocks = vi.hoisted(() => ({
  authTest: vi.fn(),
  socketStart: vi.fn(),
  socketDisconnect: vi.fn(),
  socketOn: vi.fn(),
  postMessage: vi.fn(),
  userInfo: vi.fn(),
}));

vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(() => ({
    auth: { test: slackMocks.authTest },
    chat: { postMessage: slackMocks.postMessage },
    users: { info: slackMocks.userInfo },
  })),
}));

vi.mock("@slack/socket-mode", () => ({
  SocketModeClient: vi.fn(() => ({
    on: slackMocks.socketOn,
    start: slackMocks.socketStart,
    disconnect: slackMocks.socketDisconnect,
  })),
}));

let temporary: string;
beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "cola-slack-gateway-test-"));
  vi.spyOn(os, "tmpdir").mockReturnValue(temporary);
  for (const mock of Object.values(slackMocks)) mock.mockReset();
  slackMocks.socketDisconnect.mockResolvedValue(undefined);
  slackMocks.authTest.mockResolvedValue({ user_id: "UBOT", user: "cola", team_id: "T123" });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(temporary, { recursive: true, force: true });
});

async function receive(event: SlackMessageEvent, type = "message") {
  const listener = slackMocks.socketOn.mock.calls.find(([name]) => name === type)?.[1];
  expect(listener).toBeDefined();
  const ack = vi.fn(async () => {});
  await listener({ event, ack });
  expect(ack).toHaveBeenCalledOnce();
}

describe("slack gateway startup", () => {
  it("records auth failures in gateway status", async () => {
    slackMocks.authTest.mockRejectedValueOnce(new Error("invalid_auth"));
    const ctx = makeGatewayContext();
    await expect(startGateway(ctx)).rejects.toThrow("invalid_auth");
    expect(ctx.state.lastError).toBe("invalid_auth");
    expect(resolvePluginText(getGatewayStatus(ctx).message, { "zh-CN": zhCN }, "zh-CN")).toBe(
      "未连接",
    );
    expect(getGatewayStatus(ctx)).toMatchObject({ connected: false, configured: true });
  });

  it("connects with an empty allowlist and only replies with setup IDs", async () => {
    const ctx = makeGatewayContext("");
    expect(
      slack.config?.schema?.fields.find((field) => field.key === "allowedIds")?.required,
    ).not.toBe(true);
    await startGateway(ctx);
    expect(slackMocks.socketStart).toHaveBeenCalledOnce();
    expect(getGatewayStatus(ctx)).toMatchObject({ connected: true, configured: true });

    await receive({ channel: "D123", channel_type: "im", ts: "1", user: "U123", text: "hello" });
    await receive({ channel: "C123", ts: "2", user: "U456", text: "<@UBOT> hello" }, "app_mention");
    await receive({ channel: "C123", ts: "3", user: "U456", text: "ordinary channel message" });
    expect(slackMocks.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { channel: "D123", text: "Slack access is not configured.\nUser ID: U123\nChat ID: D123" },
      { channel: "C123", text: "Slack access is not configured.\nUser ID: U456\nChat ID: C123" },
    ]);
    expect(ctx.deliver).not.toHaveBeenCalled();
    expect(ctx.runtime.identity.bind).not.toHaveBeenCalled();
  });

  it("delivers messages only after their sender is allowed", async () => {
    const ctx = makeGatewayContext("U123");
    await startGateway(ctx);
    await receive({ channel: "D123", channel_type: "im", ts: "1", user: "U123", text: "hello" });
    await receive({ channel: "D456", channel_type: "im", ts: "2", user: "U456", text: "blocked" });
    expect(ctx.deliver).toHaveBeenCalledOnce();
    expect(ctx.deliver).toHaveBeenCalledWith(expect.objectContaining({ message: "hello" }));
    expect(ctx.runtime.identity.bind).toHaveBeenCalledOnce();
    expect(ctx.runtime.identity.bind).toHaveBeenCalledWith("U123");
  });

  it.each(["botToken", "appToken"])("does not connect without %s", async (missing) => {
    const ctx = makeGatewayContext("");
    ctx.config = { ...ctx.config, [missing]: "" };
    await startGateway(ctx);
    expect(slackMocks.authTest).not.toHaveBeenCalled();
    expect(slackMocks.socketStart).not.toHaveBeenCalled();
    expect(getGatewayStatus(ctx)).toMatchObject({ connected: false, configured: false });
  });
  it("does not authenticate or connect when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeGatewayContext("U123", controller.signal);
    await startGateway(ctx);
    expect(slackMocks.authTest).not.toHaveBeenCalled();
    expect(slackMocks.socketStart).not.toHaveBeenCalled();
    expect(ctx.state.connected).toBe(false);
  });

  it("does not resume startup after shutdown while authentication is pending", async () => {
    let finishAuth!: (value: unknown) => void;
    slackMocks.authTest.mockReturnValueOnce(
      new Promise((resolve) => {
        finishAuth = resolve;
      }),
    );
    const controller = new AbortController();
    const ctx = makeGatewayContext("U123", controller.signal);
    const startup = startGateway(ctx);
    controller.abort();
    await stopGateway(ctx);
    finishAuth({ user_id: "UBOT", team_id: "T123" });
    await startup;
    expect(slackMocks.socketStart).not.toHaveBeenCalled();
    expect(ctx.state.socket).toBeUndefined();
    expect(ctx.state.connected).toBe(false);
  });

  it("disconnects and ignores late connected events when startup is cancelled", async () => {
    const controller = new AbortController();
    const ctx = makeGatewayContext("U123", controller.signal);
    slackMocks.socketStart.mockImplementationOnce(async () => {
      controller.abort();
      slackMocks.socketOn.mock.calls.find(([name]) => name === "connected")![1]();
    });
    await startGateway(ctx);
    expect(slackMocks.socketDisconnect).toHaveBeenCalled();
    expect(ctx.state.connected).toBe(false);
  });

  it.each(["abort-second", "identity-error", "deliver-error", "abort-before-delivery", "success"])(
    "handles attachment ownership on %s",
    async (outcome) => {
      const controller = new AbortController();
      const ctx = makeGatewayContext("U123", controller.signal);
      await startGateway(ctx);
      let downloads = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (++downloads === 2) {
            controller.abort();
            throw new DOMException("Stopped", "AbortError");
          }
          return new Response("downloaded attachment");
        }),
      );
      if (outcome === "identity-error")
        vi.mocked(ctx.runtime.identity.resolve).mockRejectedValueOnce(new Error("identity failed"));
      if (outcome === "deliver-error")
        vi.mocked(ctx.deliver).mockRejectedValueOnce(new Error("delivery failed"));
      if (outcome === "abort-before-delivery")
        slackMocks.userInfo.mockImplementationOnce(async () => {
          controller.abort();
          return {};
        });
      const files = [{ id: "F1", name: "first.txt", url_private: "https://slack.example/first" }];
      if (outcome === "abort-second")
        files.push({ id: "F2", name: "second.txt", url_private: "https://slack.example/second" });
      await receive({
        channel: "D123",
        channel_type: "im",
        ts: "1",
        user: "U123",
        text: "files",
        files,
      });
      const remaining = await readdir(path.join(temporary, "cola-slack"));
      if (outcome === "success") {
        expect(ctx.deliver).toHaveBeenCalledOnce();
        expect(remaining).toHaveLength(1);
        const delivered = vi.mocked(ctx.deliver).mock.calls[0][0];
        expect(await readFile(delivered.attachments![0], "utf8")).toBe("downloaded attachment");
      } else {
        expect(remaining).toEqual([]);
        if (outcome !== "deliver-error") expect(ctx.deliver).not.toHaveBeenCalled();
      }
    },
  );
});

function makeGatewayContext(
  allowedIds = "C123",
  signal = new AbortController().signal,
): GatewayContext<SlackGatewayState> {
  return {
    config: { botToken: "xoxb-token", appToken: "xapp-token", allowedIds },
    state: {},
    abortSignal: signal,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    runtime: {
      identity: { resolve: vi.fn(), bind: vi.fn(), unbind: vi.fn() },
      i18n: { text: async (message) => resolvePluginText(message, {}, "en") },
    },
    deliver: vi.fn(),
  } as unknown as GatewayContext<SlackGatewayState>;
}
