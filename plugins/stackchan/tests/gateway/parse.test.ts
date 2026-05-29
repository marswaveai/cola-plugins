import { describe, expect, it } from "vitest";
import { parseDeviceMessage } from "../../src/gateway/parse";

describe("parseDeviceMessage", () => {
  it("parses hello", () => {
    const msg = parseDeviceMessage(
      JSON.stringify({ type: "hello", deviceId: "dev-1", name: "Bob", token: "t" }),
    );
    expect(msg).toEqual({ type: "hello", deviceId: "dev-1", name: "Bob", token: "t" });
  });

  it("rejects hello missing deviceId", () => {
    expect(parseDeviceMessage(JSON.stringify({ type: "hello" }))).toBeNull();
  });

  it("parses audio.start with sampleRate default applied at use site", () => {
    const msg = parseDeviceMessage(
      JSON.stringify({ type: "audio.start", promptId: "p1", language: "zh" }),
    );
    expect(msg).toEqual({ type: "audio.start", promptId: "p1", language: "zh" });
  });

  it("rejects audio.start missing promptId", () => {
    expect(parseDeviceMessage(JSON.stringify({ type: "audio.start" }))).toBeNull();
  });

  it("parses audio.end", () => {
    const msg = parseDeviceMessage(
      JSON.stringify({ type: "audio.end", promptId: "p1", samplesTotal: 48000 }),
    );
    expect(msg).toEqual({ type: "audio.end", promptId: "p1", samplesTotal: 48000 });
  });

  it("parses pong", () => {
    expect(parseDeviceMessage(JSON.stringify({ type: "pong", timestamp: 42 }))).toEqual({
      type: "pong",
      timestamp: 42,
    });
  });

  it("parses status (promptId on top level, extras under details)", () => {
    const msg = parseDeviceMessage(JSON.stringify({ type: "status", battery: 88, promptId: "p1" }));
    expect(msg).toEqual({
      type: "status",
      promptId: "p1",
      details: { battery: 88 },
    });
  });

  it("parses status without extras (no details field)", () => {
    const msg = parseDeviceMessage(JSON.stringify({ type: "status" }));
    expect(msg).toEqual({ type: "status" });
  });

  it("returns null for invalid json", () => {
    expect(parseDeviceMessage("not json")).toBeNull();
  });

  it("returns null for unknown type", () => {
    expect(parseDeviceMessage(JSON.stringify({ type: "made-up" }))).toBeNull();
  });

  it("drops hello.name when it is not a string", () => {
    const msg = parseDeviceMessage(JSON.stringify({ type: "hello", deviceId: "dev-1", name: 99 }));
    expect(msg).toEqual({ type: "hello", deviceId: "dev-1" });
  });

  it("drops audio.start.sampleRate when it is not a number", () => {
    const msg = parseDeviceMessage(
      JSON.stringify({ type: "audio.start", promptId: "p1", sampleRate: "fast" }),
    );
    expect(msg).toEqual({ type: "audio.start", promptId: "p1" });
  });

  it("drops pong.timestamp when it is NaN-like (Number.isFinite fails)", () => {
    // JSON cannot represent NaN; emulate by sending a string. The same guard
    // would reject NaN/Infinity from any other source.
    const msg = parseDeviceMessage(JSON.stringify({ type: "pong", timestamp: "tick" }));
    expect(msg).toEqual({ type: "pong" });
  });

  it("status with non-string promptId silently drops it (does not return null)", () => {
    const msg = parseDeviceMessage(JSON.stringify({ type: "status", promptId: 99, battery: 50 }));
    expect(msg).toEqual({ type: "status", details: { promptId: 99, battery: 50 } });
  });

  it("hello trims whitespace around deviceId", () => {
    const msg = parseDeviceMessage(JSON.stringify({ type: "hello", deviceId: "  dev-trim  " }));
    expect(msg).toEqual({ type: "hello", deviceId: "dev-trim" });
  });

  it("status.details strips dangerous keys (__proto__, constructor, prototype)", () => {
    const raw =
      '{"type":"status","__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2},"battery":50}';
    const msg = parseDeviceMessage(raw);
    expect(msg).toEqual({ type: "status", details: { battery: 50 } });
    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("parses prompt with text", () => {
    expect(
      parseDeviceMessage(JSON.stringify({ type: "prompt", text: "hello world", promptId: "p1" })),
    ).toEqual({ type: "prompt", text: "hello world", promptId: "p1" });
  });

  it("rejects prompt missing text", () => {
    expect(parseDeviceMessage(JSON.stringify({ type: "prompt" }))).toBeNull();
  });
});
