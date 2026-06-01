import { describe, expect, it } from "vitest";
import { SentenceBuffer } from "../../src/outbound/sentence-buffer";

describe("SentenceBuffer", () => {
  it("splits on Chinese full stop", () => {
    const buf = new SentenceBuffer();
    const out = buf.feed("你好。再见。");
    expect(out).toEqual(["你好。", "再见。"]);
  });

  it("keeps partial sentence buffered until punctuation", () => {
    const buf = new SentenceBuffer();
    expect(buf.feed("hello")).toEqual([]);
    expect(buf.feed(" world.")).toEqual(["hello world."]);
  });

  it("flush returns the remainder", () => {
    const buf = new SentenceBuffer();
    buf.feed("an unfinished thought");
    expect(buf.flush()).toBe("an unfinished thought");
    expect(buf.flush()).toBeNull();
  });

  it("skips code blocks", () => {
    const buf = new SentenceBuffer();
    const out = buf.feed("hello.\n```\ncode goes here.\n```\nworld.");
    // 'hello.' is emitted, code-block content is suppressed,
    // 'world.' is emitted after the fence closes.
    expect(out.length).toBe(2);
    expect(out[0]).toBe("hello.");
    expect(out[1]).toBe("world.");
  });

  it("skips inline code", () => {
    const buf = new SentenceBuffer();
    const out = buf.feed("use `npm install`.");
    expect(out).toEqual(["use ."]);
  });

  it("strips emoji", () => {
    const buf = new SentenceBuffer();
    const out = buf.feed("hello 🎉 world.");
    expect(out).toEqual(["hello world."]);
  });

  it("flush returns null when buffer is only emoji/whitespace", () => {
    const buf = new SentenceBuffer();
    buf.feed("🎉");
    expect(buf.flush()).toBeNull();
  });

  it("reset clears state", () => {
    const buf = new SentenceBuffer();
    buf.feed("start of sentence");
    buf.reset();
    expect(buf.feed("done.")).toEqual(["done."]);
  });
});
