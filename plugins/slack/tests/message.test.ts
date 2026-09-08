import { describe, expect, it } from "vitest";
import { parseSlackMessage } from "../src/message.js";
import type { SlackMessageEvent } from "../src/types.js";

describe("slack message parsing", () => {
  it("uses the same channel session for a root message and its thread replies", () => {
    const root: SlackMessageEvent = {
      channel: "C123",
      channel_type: "channel",
      ts: "1710000000.000100",
      user: "U123",
      text: "<@B123> hello",
    };
    const reply: SlackMessageEvent = {
      channel: "C123",
      channel_type: "channel",
      ts: "1710000001.000200",
      thread_ts: root.ts,
      user: "U123",
      text: "follow-up",
    };

    const parsedRoot = parseSlackMessage(root, "T123", "B123");
    const parsedReply = parseSlackMessage(reply, "T123", "B123");

    expect(parsedRoot?.threadId).toBe(root.ts);
    expect(parsedReply?.threadId).toBe(root.ts);
    expect(parsedRoot?.sessionId).toEqual(parsedReply?.sessionId);
  });
  it("keeps separate DM threads isolated while preserving unthreaded DM sessions", () => {
    const event = { channel: "D123", channel_type: "im", ts: "11", user: "U123", text: "hello" };
    const plain = parseSlackMessage(event, "T123", "B123")!;
    const first = parseSlackMessage({ ...event, thread_ts: "10" }, "T123", "B123")!;
    const followup = parseSlackMessage({ ...event, ts: "12", thread_ts: "10" }, "T123", "B123")!;
    const second = parseSlackMessage({ ...event, ts: "21", thread_ts: "20" }, "T123", "B123")!;
    expect(plain.sessionId).toEqual(["chat", "T123", "D123", "sender", "U123"]);
    expect(first.sessionId).toEqual(followup.sessionId);
    expect(first.sessionId).not.toEqual(second.sessionId);
    expect(first.sessionId).not.toEqual(plain.sessionId);
    expect([first.threadId, second.threadId]).toEqual(["10", "20"]);
  });
});
