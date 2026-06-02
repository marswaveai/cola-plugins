import { describe, expect, it } from "vitest";
import { isBotMentioned } from "../src/util/mention.js";
import type { FeishuMention } from "../src/api/types.js";

function mention(openId: string): FeishuMention {
  return { key: "@_user_1", id: { open_id: openId }, name: "Bot" };
}

describe("isBotMentioned", () => {
  it("returns true when a mention matches the bot open_id", () => {
    expect(isBotMentioned([mention("ou_bot"), mention("ou_alice")], "ou_bot")).toBe(true);
  });

  it("returns false when no mention matches the bot open_id", () => {
    expect(isBotMentioned([mention("ou_alice")], "ou_bot")).toBe(false);
  });

  it("returns false when there are no mentions", () => {
    expect(isBotMentioned([], "ou_bot")).toBe(false);
    expect(isBotMentioned(undefined, "ou_bot")).toBe(false);
  });

  it("returns false when botOpenId is undefined", () => {
    expect(isBotMentioned([mention("ou_bot")], undefined)).toBe(false);
  });
});
