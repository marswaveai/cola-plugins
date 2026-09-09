import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { resolvePluginText } from "@marswave/cola-plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import feishu from "../src/index.js";
import zhCN from "../locales/zh-CN.json";

const gateway = feishu.channel!.gateway!;
type Context = Parameters<typeof gateway.start>[0];

let directory: string;
let server: http.Server;
let context: Context;
let controller: AbortController;
let mode: "ready" | "invalid-id" | "invalid-secret" | "unavailable";
let holdHandshake: boolean;
let releaseHandshake: (() => void) | undefined;
let connectionCount: number;
const sockets = new Set<Socket>();
const webSockets = new Set<Socket>();

function status() {
  return gateway.getStatus!(context);
}

async function commandReply(args: string) {
  const command = feishu.commands![0];
  const result = await command.execute({ config: context.config, args } as Parameters<
    typeof command.execute
  >[0]);
  return resolvePluginText(result?.reply, { "zh-CN": zhCN }, "zh-CN");
}

beforeEach(async () => {
  mode = "ready";
  holdHandshake = false;
  releaseHandshake = undefined;
  connectionCount = 0;
  directory = await mkdtemp(path.join(os.tmpdir(), "cola-feishu-gateway-test-"));
  server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const invalidSecret =
      mode === "invalid-secret" || input.app_secret === "invalid" || input.AppSecret === "invalid";
    const error =
      mode === "invalid-id"
        ? { code: 10014, msg: "app id not exists" }
        : invalidSecret
          ? { code: 10013, msg: "app secret invalid" }
          : undefined;
    let body: unknown;
    if (request.url?.includes("/auth/")) {
      body = error ?? { code: 0, msg: "ok", tenant_access_token: "local-token", expire: 7200 };
    } else if (request.url?.includes("/bot/v3/info")) {
      body = { code: 0, msg: "ok", bot: { open_id: "ou_local_bot" } };
    } else if (request.url === "/callback/ws/endpoint") {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server address");
      body = error
        ? { code: 514, msg: error.msg, data: {} }
        : mode === "unavailable"
          ? { code: 1000040343, msg: "QA simulated connection outage", data: {} }
          : {
              code: 0,
              msg: "ok",
              data: {
                URL: `ws://127.0.0.1:${address.port}/ws?device_id=qa&service_id=1`,
                ClientConfig: {
                  PingInterval: 60,
                  ReconnectCount: -1,
                  ReconnectInterval: 0.05,
                  ReconnectNonce: 0,
                },
              },
            };
    } else {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket: Socket) => {
    socket.resume();
    socket.on("end", () => socket.end());
    const accept = createHash("sha1")
      .update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    const open = () => {
      if (socket.destroyed) return;
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      webSockets.add(socket);
      socket.on("close", () => webSockets.delete(socket));
      connectionCount++;
    };
    if (holdHandshake) releaseHandshake = open;
    else open();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  controller = new AbortController();
  context = {
    config: {
      pluginDir: directory,
      accounts: {
        default: {
          appId: "cli_0000000000000000",
          appSecret: "local-secret",
          domain: `http://127.0.0.1:${address.port}`,
        },
      },
    },
    state: {},
    runtime: { identity: { bind: vi.fn(), resolve: vi.fn() } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    abortSignal: controller.signal,
    deliver: vi.fn(),
  } as unknown as Context;
});

afterEach(async () => {
  controller.abort();
  await gateway.stop!(context);
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  webSockets.clear();
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("Feishu connection status with the real SDK", () => {
  it.each([
    ["invalid-id", "app id not exists"],
    ["invalid-secret", "app secret invalid"],
  ] as const)("reports %s without claiming a connection", async (failure, reason) => {
    mode = failure;
    await gateway.start(context);
    expect(status()).toMatchObject({ connected: false, configured: true });
    await vi.waitFor(() => expect(status().details).toContain(reason));
    expect(connectionCount).toBe(0);
    expect(resolvePluginText(status().message, { "zh-CN": zhCN }, "zh-CN")).toBe("连接失败");
    expect(await commandReply("status")).toContain("连接失败");
    expect(await commandReply("status")).toContain(reason);
    expect(await commandReply("accounts")).toContain("连接失败");
  });

  it("waits for the WebSocket handshake before reporting connected", async () => {
    holdHandshake = true;
    await gateway.start(context);
    await vi.waitFor(() => expect(releaseHandshake).toBeTypeOf("function"));
    expect(status()).toMatchObject({ connected: false, configured: true });
    expect(resolvePluginText(status().message, { "zh-CN": zhCN }, "zh-CN")).toBe("正在连接…");
    releaseHandshake!();
    await vi.waitFor(() => expect(status().connected).toBe(true));
    expect(status().details).toBeUndefined();
    expect(await commandReply("status")).toContain("已连接");
  });

  it("exposes retryable startup errors that only appear in SDK logs", async () => {
    mode = "unavailable";
    await gateway.start(context);
    await vi.waitFor(() => expect(status().details).toContain("QA simulated connection outage"));
    expect(status()).toMatchObject({ connected: false, configured: true });
    expect(connectionCount).toBe(0);
  });

  it("reports an invalid App ID format without waiting for a connection callback", async () => {
    const accounts = context.config.accounts as Record<string, Record<string, unknown>>;
    accounts.default.appId = "invalid-app-id";
    await gateway.start(context);
    await vi.waitFor(() => expect(status().details).toBeTruthy());
    expect(status()).toMatchObject({ connected: false, configured: true });
    expect(connectionCount).toBe(0);
    expect(resolvePluginText(status().message, { "zh-CN": zhCN }, "zh-CN")).toBe("连接失败");
  });

  it("reports a dropped connection and clears diagnostics after recovery", async () => {
    await gateway.start(context);
    await vi.waitFor(() => expect(connectionCount).toBe(1));
    await vi.waitFor(() => expect(status().connected).toBe(true));
    mode = "unavailable";
    for (const socket of webSockets) socket.destroy();
    await vi.waitFor(() => expect(status().connected).toBe(false));
    await vi.waitFor(() => expect(status().details).toContain("QA simulated connection outage"));
    expect(resolvePluginText(status().message, { "zh-CN": zhCN }, "zh-CN")).toBe(
      "连接已断开，正在重连…",
    );
    mode = "ready";
    await vi.waitFor(() => expect(status().connected).toBe(true));
    expect(status().details).toBeUndefined();
    expect(connectionCount).toBe(2);
  });

  it("counts only connected accounts and reports failures alongside healthy accounts", async () => {
    const accounts = context.config.accounts as Record<string, Record<string, unknown>>;
    accounts.broken = { ...accounts.default, appSecret: "invalid" };
    await gateway.start(context);
    await vi.waitFor(() => expect(connectionCount).toBe(1));
    await vi.waitFor(() => expect(status().details).toContain("broken: "));
    expect(status()).toMatchObject({ connected: true, configured: true });
    expect(status().details).toContain("app secret invalid");
    expect(resolvePluginText(status().message, { "zh-CN": zhCN }, "zh-CN")).toBe("已连接账号数：1");
  });

  it("cleans up an interrupted handshake without a late connection", async () => {
    holdHandshake = true;
    await gateway.start(context);
    await vi.waitFor(() => expect(releaseHandshake).toBeTypeOf("function"));
    await gateway.stop!(context);
    releaseHandshake!();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(status().connected).toBe(false);
    await vi.waitFor(() => expect(webSockets.size).toBe(0));
  });

  it("replaces a failed connection after updating credentials", async () => {
    const accounts = context.config.accounts as Record<string, Record<string, unknown>>;
    accounts.default.appSecret = "invalid";
    await gateway.start(context);
    await vi.waitFor(() => expect(status().details).toContain("app secret invalid"));
    accounts.default.appSecret = "corrected-secret";
    await gateway.reload!(context);
    await vi.waitFor(() => expect(status().connected).toBe(true));
    expect(status().details).toBeUndefined();
    expect(connectionCount).toBe(1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
  });

  it("does not start a connection after cancellation", async () => {
    controller.abort();
    await gateway.start(context);
    expect(status()).toMatchObject({ connected: false, configured: true });
    expect(status().details).toBeUndefined();
    expect(connectionCount).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
