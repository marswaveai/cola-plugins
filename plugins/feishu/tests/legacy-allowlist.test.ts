import type { PluginLogger, PluginRuntime } from "@marswave/cola-plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { migrateLegacyAllowlist, parseAuthorizedOpenIds } from "../src/auth/legacy-allowlist.js";

function makeLogger(): PluginLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeIdentity(): PluginRuntime["identity"] {
  return {
    resolve: vi.fn(async () => null),
    bind: vi.fn(async () => {}),
    unbind: vi.fn(async () => {}),
  };
}

describe("parseAuthorizedOpenIds", () => {
  it("parses a comma/space separated string", () => {
    expect([...parseAuthorizedOpenIds("ou_a, ou_b ou_c")]).toEqual(["ou_a", "ou_b", "ou_c"]);
  });

  it("parses an array of strings", () => {
    expect([...parseAuthorizedOpenIds([" ou_a ", "ou_b"])]).toEqual(["ou_a", "ou_b"]);
  });

  it("returns an empty set for empty/invalid input", () => {
    expect(parseAuthorizedOpenIds(undefined).size).toBe(0);
    expect(parseAuthorizedOpenIds("").size).toBe(0);
    expect(parseAuthorizedOpenIds(42).size).toBe(0);
  });
});

describe("migrateLegacyAllowlist", () => {
  it("binds each unique legacy open_id once across accounts and logs a summary", async () => {
    const identity = makeIdentity();
    const logger = makeLogger();

    await migrateLegacyAllowlist(
      [{ authorizedOpenIds: "ou_a, ou_b" }, { authorizedOpenIds: ["ou_b", "ou_c"] }],
      identity,
      logger,
    );

    expect((identity.bind as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).sort()).toEqual([
      "ou_a",
      "ou_b",
      "ou_c",
    ]);
    expect(identity.bind).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalled();
  });

  it("is a no-op when no account has a legacy allowlist", async () => {
    const identity = makeIdentity();
    const logger = makeLogger();

    await migrateLegacyAllowlist([{}, { authorizedOpenIds: "" }], identity, logger);

    expect(identity.bind).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
