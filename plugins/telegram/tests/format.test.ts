import { describe, expect, it } from "vitest";
import { formatTelegramMarkdown } from "../src/format.js";

describe("telegram markdown formatting", () => {
  it("formats common inline markdown as Telegram HTML", () => {
    expect(formatTelegramMarkdown("**bold** and *italic* with `code`").text).toBe(
      "<b>bold</b> and <i>italic</i> with <code>code</code>",
    );
  });

  it("formats headings, bullets, tasks, and links", () => {
    expect(
      formatTelegramMarkdown(
        "# Title\n- **one**\n- [site](https://example.com?a=1&b=2)\n- [x] done",
      ).text,
    ).toBe(
      '<b>Title</b>\n• <b>one</b>\n• <a href="https://example.com?a=1&amp;b=2">site</a>\n☑ done',
    );
  });

  it("escapes html inside text and code blocks", () => {
    expect(formatTelegramMarkdown("2 < 3 & 4\n```ts\nconst x = a < b;\n```").text).toBe(
      "2 &lt; 3 &amp; 4\n<pre><code>const x = a &lt; b;</code></pre>",
    );
  });
});
