import { describe, expect, it } from "vitest";
import { normalizeDeliveryTarget, resolveReceiver } from "../src/outbound/send.js";
import type { ChatMap } from "../src/gateway/chat-map.js";

/** Minimal stand-in: resolveReceiver only needs `get`. */
function fakeChatMap(entries: Record<string, string> = {}): ChatMap {
  return { get: (openId: string) => entries[openId] } as unknown as ChatMap;
}

const CHAT_ID = "oc_444a075683cff5b4bbcd49fa869afc87";

describe("normalizeDeliveryTarget", () => {
  it("treats a bare chat id as a chat target", () => {
    expect(normalizeDeliveryTarget(CHAT_ID)).toEqual({ id: CHAT_ID, kind: "chat" });
  });

  it("treats a bare open id as a user target", () => {
    expect(normalizeDeliveryTarget("ou_alice")).toEqual({ id: "ou_alice", kind: "user" });
  });

  it("honours explicit chat:/user: prefixes", () => {
    expect(normalizeDeliveryTarget(`chat:${CHAT_ID}`)).toEqual({ id: CHAT_ID, kind: "chat" });
    expect(normalizeDeliveryTarget("user:ou_alice")).toEqual({ id: "ou_alice", kind: "user" });
  });

  it("prefers the id prefix over a mismatched explicit prefix", () => {
    expect(normalizeDeliveryTarget(`user:${CHAT_ID}`)).toEqual({ id: CHAT_ID, kind: "chat" });
  });

  it("returns undefined for empty targets", () => {
    expect(normalizeDeliveryTarget("")).toBeUndefined();
    expect(normalizeDeliveryTarget("chat:")).toBeUndefined();
  });
});

describe("resolveReceiver", () => {
  it("sends a bare chat id as chat_id (cron redelivery regression)", () => {
    expect(resolveReceiver(CHAT_ID, fakeChatMap())).toEqual({
      receiveId: CHAT_ID,
      receiveIdType: "chat_id",
    });
  });

  it("maps a known open id to its direct chat", () => {
    expect(resolveReceiver("ou_alice", fakeChatMap({ ou_alice: CHAT_ID }))).toEqual({
      receiveId: CHAT_ID,
      receiveIdType: "chat_id",
    });
  });

  it("falls back to open_id when the user has no known chat", () => {
    expect(resolveReceiver("user:ou_bob", fakeChatMap())).toEqual({
      receiveId: "ou_bob",
      receiveIdType: "open_id",
    });
  });

  it("keeps explicit chat targets working", () => {
    expect(resolveReceiver(`chat:${CHAT_ID}`, fakeChatMap())).toEqual({
      receiveId: CHAT_ID,
      receiveIdType: "chat_id",
    });
  });
});
