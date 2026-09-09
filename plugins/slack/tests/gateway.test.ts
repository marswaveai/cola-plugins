import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { getEventListeners } from "node:events";
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
  it("removes abort listeners on stop and only disconnects the current socket at shutdown", async () => {
    const controller = new AbortController();
    const ctx = makeGatewayContext("U123", controller.signal);
    for (let i = 0; i < 12; i++) {
      await startGateway(ctx);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
      await stopGateway(ctx);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    }
    await startGateway(ctx);
    slackMocks.socketDisconnect.mockClear();
    controller.abort();
    await Promise.resolve();
    expect(slackMocks.socketDisconnect).toHaveBeenCalledOnce();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("removes the abort listener when connection startup fails", async () => {
    const controller = new AbortController();
    const ctx = makeGatewayContext("U123", controller.signal);
    slackMocks.socketStart.mockRejectedValueOnce(new Error("Connection failed"));
    await expect(startGateway(ctx)).rejects.toThrow("Connection failed");
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await startGateway(ctx);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
    await stopGateway(ctx);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

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

  it("logs acknowledgement failures without rejecting the event listener", async () => {
    const ctx = makeGatewayContext("U123");
    await startGateway(ctx);
    const listener = slackMocks.socketOn.mock.calls.find(([name]) => name === "message")![1];
    const error = new Error("Socket closed during acknowledgement");
    await expect(
      listener({ event: {}, ack: vi.fn().mockRejectedValue(error) }),
    ).resolves.toBeUndefined();
    expect(ctx.logger.warn).toHaveBeenCalledWith("Failed to handle Slack event", error);
    expect(ctx.deliver).not.toHaveBeenCalled();
  });

  it.each(["channel", "group", "mpim"])(
    "ignores unmentioned %s posts before downloading or binding their sender",
    async (channelType) => {
      const ctx = makeGatewayContext("C123");
      await startGateway(ctx);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("unrelated attachment")),
      );
      await receive({
        channel: "C123",
        channel_type: channelType,
        ts: "1",
        user: "U123",
        text: "ordinary post",
        files: [{ id: "F1", name: "note.txt", url_private: "https://slack.example/file" }],
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(ctx.runtime.identity.resolve).not.toHaveBeenCalled();
      expect(ctx.runtime.identity.bind).not.toHaveBeenCalled();
      expect(slackMocks.userInfo).not.toHaveBeenCalled();
      expect(ctx.deliver).not.toHaveBeenCalled();
      expect(ctx.state.lastEventAt).toBeUndefined();
    },
  );

  it("delivers channel mentions once across message and app_mention events", async () => {
    const ctx = makeGatewayContext("C123");
    await startGateway(ctx);
    const event = { channel: "C123", ts: "1", user: "U123", text: "<@UBOT> hello" };
    await receive(event);
    await receive(event, "app_mention");
    expect(ctx.deliver).toHaveBeenCalledOnce();
    expect(ctx.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ mentionedBot: true, message: "hello" }),
    );
  });

  it("rejects more than ten attachments before fetching or binding", async () => {
    const ctx = makeGatewayContext("U123");
    await startGateway(ctx);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("file")),
    );
    await receive({
      channel: "D123",
      channel_type: "im",
      ts: "1",
      user: "U123",
      text: "files",
      files: Array.from({ length: 11 }, (_, index) => ({
        id: `F${index}`,
        url_private: `https://slack.example/${index}`,
      })),
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.runtime.identity.bind).not.toHaveBeenCalled();
    expect(ctx.deliver).not.toHaveBeenCalled();
  });

  it("cleans up the whole message when two valid files exceed 100 MiB together", async () => {
    const ctx = makeGatewayContext("U123");
    await startGateway(ctx);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        let chunks = 60;
        const chunk = new Uint8Array(1024 * 1024);
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (chunks-- > 0) controller.enqueue(chunk);
              else controller.close();
            },
          }),
        );
      }),
    );
    await receive({
      channel: "D123",
      channel_type: "im",
      ts: "1",
      user: "U123",
      text: "files",
      files: [
        { id: "F1", url_private: "https://slack.example/one" },
        { id: "F2", url_private: "https://slack.example/two" },
        { id: "F3", url_private: "https://slack.example/three" },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readdir(path.join(temporary, "cola-slack"))).toEqual([]);
    expect(ctx.runtime.identity.bind).not.toHaveBeenCalled();
    expect(ctx.deliver).not.toHaveBeenCalled();
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
