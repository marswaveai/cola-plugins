import { describe, expect, it } from "vitest";
import { formatSlackMrkdwn } from "../src/format.js";

describe("slack Markdown links", () => {
  it.each([
    [
      "[Group](https://en.wikipedia.org/wiki/Group_(mathematics))",
      "<https://en.wikipedia.org/wiki/Group_(mathematics)|Group>",
    ],
    ["[Nested](https://example.com/a(b(c)d)e)", "<https://example.com/a(b(c)d)e|Nested>"],
    [String.raw`[Escaped](https://example.com/a\(b\)c)`, "<https://example.com/a(b)c|Escaped>"],
    [String.raw`[Close](https://example.com/a\)b)`, "<https://example.com/a)b|Close>"],
    [String.raw`[Open](https://example.com/a\(b)`, "<https://example.com/a(b|Open>"],
    [
      "See ([One](https://example.com/a(b))) and [Two](https://example.com/two).",
      "See (<https://example.com/a(b)|One>) and <https://example.com/two|Two>.",
    ],
    ["[Query](https://example.com/?q=(a)&b=2)", "<https://example.com/?q=(a)&amp;b=2|Query>"],
  ])("preserves the full destination in %s", (input, expected) => {
    expect(formatSlackMrkdwn(input)).toBe(expected);
  });

  it.each([
    "[Unbalanced](https://example.com/a(b)",
    "[Unsafe](javascript:alert(1))",
    "`[Code](https://example.com/a(b))`",
  ])("keeps malformed, unsafe, and code-span links as text: %s", (input) => {
    expect(formatSlackMrkdwn(input)).toBe(input);
  });
});
