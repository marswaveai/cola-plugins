import { describe, it, expect } from "vitest";
import {
  GroupContextTracker,
  buildGroupContextBlock,
  prependGroupContext,
  fetchGroupContext,
  type GroupContextItem,
} from "../src/gateway/group-context.js";

const userMsg = (
  id: string,
  text: string,
  sender = "ou_user",
): GroupContextItem => ({
  message_id: id,
  msg_type: "text",
  sender: { id: sender, sender_type: "user" },
  body: { content: JSON.stringify({ text }) },
});

describe("buildGroupContextBlock", () => {
  it("renders user text lines under the context header", () => {
    const block = buildGroupContextBlock(
      [userMsg("m1", "几点开会", "ou_a"), userMsg("m2", "下午三点", "ou_b")],
      { triggerMessageId: "trigger" },
    );
    expect(block).toBe(
      "[Recent group messages since your last reply — context only, not all directed at you]\n" +
        "[ou_a] 几点开会\n[ou_b] 下午三点",
    );
  });

  it("drops the trigger message and non-user senders", () => {
    const block = buildGroupContextBlock(
      [
        userMsg("trigger", "should be dropped"),
        { message_id: "bot", msg_type: "text", sender: { id: "cli_x", sender_type: "app" }, body: { content: JSON.stringify({ text: "bot reply" }) } },
        userMsg("m3", "keep me", "ou_c"),
      ],
      { triggerMessageId: "trigger" },
    );
    expect(block).toBe(
      "[Recent group messages since your last reply — context only, not all directed at you]\n[ou_c] keep me",
    );
  });

  it("renders placeholders for non-text message types", () => {
    const block = buildGroupContextBlock(
      [{ message_id: "i1", msg_type: "image", sender: { id: "ou_a", sender_type: "user" }, body: { content: "{}" } }],
      { triggerMessageId: "trigger" },
    );
    expect(block).toContain("[ou_a] [图片]");
  });

  it("extracts language-keyed post (rich text) content", () => {
    const post: GroupContextItem = {
      message_id: "p1",
      msg_type: "post",
      sender: { id: "ou_a", sender_type: "user" },
      body: {
        content: JSON.stringify({
          zh_cn: {
            title: "标题",
            content: [[{ tag: "text", text: "今天开会" }, { tag: "at", user_name: "张三" }]],
          },
        }),
      },
    };
    const block = buildGroupContextBlock([post], { triggerMessageId: "trigger" });
    expect(block).toContain("[ou_a] 标题 今天开会@张三");
  });

  it("keeps only the most recent maxLines messages", () => {
    const items = Array.from({ length: 5 }, (_, i) => userMsg(`m${i}`, `line ${i}`));
    const block = buildGroupContextBlock(items, { triggerMessageId: "trigger", maxLines: 2 });
    expect(block).toContain("line 3");
    expect(block).toContain("line 4");
    expect(block).not.toContain("line 0");
  });

  it("returns undefined when nothing remains", () => {
    expect(buildGroupContextBlock([], { triggerMessageId: "trigger" })).toBeUndefined();
    expect(
      buildGroupContextBlock([userMsg("trigger", "only the trigger")], { triggerMessageId: "trigger" }),
    ).toBeUndefined();
  });
});

describe("prependGroupContext", () => {
  it("returns the current text unchanged when block is undefined", () => {
    expect(prependGroupContext("hi", undefined)).toBe("hi");
  });

  it("joins block, current header, and current text", () => {
    expect(prependGroupContext("帮我确认时间", "BLOCK")).toBe(
      "BLOCK\n\n[Current message — reply to this]\n帮我确认时间",
    );
  });
});

describe("GroupContextTracker", () => {
  it("stores and returns per-chat watermarks", () => {
    const t = new GroupContextTracker();
    expect(t.get("oc_1")).toBeUndefined();
    t.set("oc_1", 1000);
    expect(t.get("oc_1")).toBe(1000);
    expect(t.get("oc_2")).toBeUndefined();
  });
});

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as never;

function clientWith(listImpl: (arg: unknown) => unknown) {
  return { im: { message: { list: listImpl } } } as never;
}

describe("fetchGroupContext", () => {
  it("uses an ascending window when a start watermark is provided", async () => {
    let captured: { params?: Record<string, unknown> } = {};
    const client = clientWith((arg) => {
      captured = arg as { params?: Record<string, unknown> };
      return { data: { items: [userMsg("m1", "hi", "ou_a")] } };
    });
    const block = await fetchGroupContext({
      client,
      logger: silentLogger,
      chatId: "oc_1",
      triggerMessageId: "trigger",
      triggerCreateTimeMs: 60_000,
      startTimeMs: 30_000,
    });
    expect(captured.params).toMatchObject({
      container_id_type: "chat",
      container_id: "oc_1",
      sort_type: "ByCreateTimeAsc",
      start_time: "30",
      end_time: "60",
    });
    expect(block).toContain("[ou_a] hi");
  });

  it("falls back to a descending window (reversed) on cold start", async () => {
    let captured: { params?: Record<string, unknown> } = {};
    const client = clientWith((arg) => {
      captured = arg as { params?: Record<string, unknown> };
      // SDK returns newest-first under ByCreateTimeDesc
      return { data: { items: [userMsg("m2", "second", "ou_b"), userMsg("m1", "first", "ou_a")] } };
    });
    const block = await fetchGroupContext({
      client,
      logger: silentLogger,
      chatId: "oc_1",
      triggerMessageId: "trigger",
      triggerCreateTimeMs: 60_000,
    });
    expect(captured.params).toMatchObject({ sort_type: "ByCreateTimeDesc", end_time: "60" });
    expect(captured.params).not.toHaveProperty("start_time");
    // reversed back to chronological: first then second
    expect(block).toBe(
      "[Recent group messages since your last reply — context only, not all directed at you]\n[ou_a] first\n[ou_b] second",
    );
  });

  it("returns undefined and does not throw when the API fails", async () => {
    const client = clientWith(() => {
      throw new Error("rate limited");
    });
    const block = await fetchGroupContext({
      client,
      logger: silentLogger,
      chatId: "oc_1",
      triggerMessageId: "trigger",
      triggerCreateTimeMs: 60_000,
    });
    expect(block).toBeUndefined();
  });
});
