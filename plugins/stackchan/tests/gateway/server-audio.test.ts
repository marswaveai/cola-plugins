import { describe, expect, it, vi } from "vitest";
import {
  handleAudioMessage,
  handleBinaryFrame,
  type StackChanState,
} from "../../src/gateway/server";
import { createDeviceRegistry } from "../../src/gateway/devices";
import type { GatewayContext } from "@marswave/cola-plugin-sdk";

function ctxStub(): GatewayContext<unknown> {
  return {
    config: {},
    runtime: {
      identity: { resolve: vi.fn(async () => "user-1"), bind: vi.fn(), unbind: vi.fn() },
      config: { get: () => ({}) },
      events: { on: () => () => {} },
      stt: {
        createStream: () => ({
          push() {},
          async finish() {
            return "你好";
          },
          cancel() {},
        }),
      },
      logger: { info() {}, warn() {}, error() {} },
      version: "test",
    },
    logger: { info() {}, warn() {}, error() {} },
    abortSignal: new AbortController().signal,
    state: {},
    deliver: vi.fn(async () => {}),
  } as unknown as GatewayContext<unknown>;
}

function fakeSocket() {
  return {
    readyState: 1,
    sent: [] as string[],
    binarySent: [] as Buffer[],
    send(payload: string | Buffer) {
      if (typeof payload === "string") this.sent.push(payload);
      else this.binarySent.push(payload);
    },
  };
}

describe("handleAudioMessage", () => {
  it("audio.start → audio.ready and audio.end → deliver + transcript.final", async () => {
    const reg = createDeviceRegistry({ now: () => 1 });
    const sock = fakeSocket() as unknown as import("ws").WebSocket;
    reg.register(sock, { deviceId: "d1" });
    const ctx = ctxStub();
    const state: StackChanState = {
      registry: reg,
      server: null,
      heartbeatTimer: null,
      statusMessage: "",
      sessions: new Map(),
      senders: new Map(),
      sendersByDevice: new Map(),
    };
    (ctx as unknown as { state: StackChanState }).state = state;

    await handleAudioMessage(ctx as unknown as GatewayContext<StackChanState>, reg, sock, {
      type: "audio.start",
      promptId: "p1",
    });
    const ready = JSON.parse((sock as unknown as ReturnType<typeof fakeSocket>).sent[0]);
    expect(ready).toEqual({ type: "audio.ready", promptId: "p1" });

    handleBinaryFrame(state, sock, Buffer.alloc(640));
    await handleAudioMessage(ctx as unknown as GatewayContext<StackChanState>, reg, sock, {
      type: "audio.end",
      promptId: "p1",
    });
    const frames = (sock as unknown as ReturnType<typeof fakeSocket>).sent.map((s: string) =>
      JSON.parse(s),
    );
    expect(frames).toContainEqual({
      type: "transcript.final",
      promptId: "p1",
      text: "你好",
    });
    expect(ctx.deliver).toHaveBeenCalledWith(expect.objectContaining({ message: "你好" }));
  });
});
