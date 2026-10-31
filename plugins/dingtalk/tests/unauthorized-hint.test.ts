import { describe, expect, it } from "vitest";
import { isPluginMessage, resolvePluginText } from "@marswave/cola-plugin-sdk";
import mod from "../src/index.js";

const channel = (mod as unknown as { channel: {
  unauthorizedHint?: (target: { kind: "user" | "group"; id: string }) => unknown;
} }).channel;

/** Resolve a PluginText to its English fallback for assertion. */
function resolve(text: unknown): string {
  expect(isPluginMessage(text)).toBe(true);
  const msg = text as { key: string; fallback: string; params?: Record<string, string> };
  let out = msg.fallback;
  for (const [k, v] of Object.entries(msg.params ?? {})) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

describe("unauthorizedHint", () => {
  it("group hint includes the group ID and the allow-group command", () => {
    const hint = channel.unauthorizedHint?.({
      kind: "group" as const,
      id: "cidhXlF3rCREs7RapJ87Hv+eQ==",
    });
    const text = resolve(hint);
    expect(text).toContain("cidhXlF3rCREs7RapJ87Hv+eQ==");
    expect(text).toContain("cola channel allow-group dingtalk cidhXlF3rCREs7RapJ87Hv+eQ==");
  });

  it("user hint includes the sender ID and the allow command", () => {
    const hint = channel.unauthorizedHint?.({ kind: "user" as const, id: "14580769531227439" });
    const text = resolve(hint);
    expect(text).toContain("14580769531227439");
    expect(text).toContain("cola channel allow dingtalk 14580769531227439");
  });

  it("hints stay resolvable through the SDK i18n layer (no missing placeholders)", () => {
    const group = channel.unauthorizedHint?.({ kind: "group", id: "cidABC==" });
    const user = channel.unauthorizedHint?.({ kind: "user", id: "U123" });
    expect(resolvePluginText(group as never, undefined, "en")).toContain("cidABC==");
    expect(resolvePluginText(user as never, undefined, "en")).toContain("U123");
  });
});
