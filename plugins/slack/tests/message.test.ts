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
});
