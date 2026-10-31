import { describe, expect, it } from "vitest";
import { parseAccountConfigs } from "../src/auth/accounts.js";
import type { DingTalkPluginConfig } from "../src/api/types.js";

describe("parseAccountConfigs", () => {
  it("parses a complete account config", () => {
    const accounts = parseAccountConfigs({
      accounts: {
        default: { clientId: "cli_test_1", clientSecret: "test-secret" },
      },
    });
    expect(accounts.size).toBe(1);
    expect(accounts.get("default")).toEqual({
      clientId: "cli_test_1",
      clientSecret: "test-secret",
    });
  });

  it("skips accounts with missing credentials", () => {
    const accounts = parseAccountConfigs({
      accounts: {
        a: { clientId: "cli_test_1", clientSecret: "test-secret" },
        b: { clientId: "cli_test_2" },
        c: {} as never,
      },
    });
    expect([...accounts.keys()]).toEqual(["a"]);
  });

  it("skips explicitly disabled accounts", () => {
    const accounts = parseAccountConfigs({
      accounts: {
        a: { clientId: "cli_test_1", clientSecret: "test-secret", enabled: false },
        b: { clientId: "cli_test_2", clientSecret: "test-secret", enabled: true },
      },
    });
    expect([...accounts.keys()]).toEqual(["b"]);
  });

  it("returns an empty map for missing or malformed account records", () => {
    expect(parseAccountConfigs({}).size).toBe(0);
    expect(parseAccountConfigs({ accounts: undefined }).size).toBe(0);
    expect(
      parseAccountConfigs({
        accounts: { x: "not-an-object" } as unknown as DingTalkPluginConfig["accounts"],
      }).size,
    ).toBe(0);
  });

  it("defaults groupEnabled to false (opt-in)", () => {
    const config: DingTalkPluginConfig = {};
    expect(config.groupEnabled ?? false).toBe(false);
  });
});
