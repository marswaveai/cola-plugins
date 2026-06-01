import { describe, expect, it } from "vitest";
import { isTelegramConfigured, readTelegramConfig, redactToken } from "../src/config.js";

describe("telegram config", () => {
  it("applies defaults and normalizes chat allowlist", () => {
    const config = readTelegramConfig({
      botToken: " 123456:secret ",
      allowedChatIds: " -1001, 2002 ,,",
      pollingTimeoutSeconds: 99,
      pollIntervalMs: -1,
    });

    expect(isTelegramConfigured(config)).toBe(true);
    expect(config.botToken).toBe("123456:secret");
    expect(config.apiBaseUrl).toBe("https://api.telegram.org");
    expect(config.pollingTimeoutSeconds).toBe(50);
    expect(config.pollIntervalMs).toBe(0);
    expect([...config.allowedChatIds]).toEqual(["-1001", "2002"]);
    expect(config.dropPendingUpdates).toBe(false);
    expect(config.ignoreBotMessages).toBe(true);
  });

  it("redacts tokens without exposing the middle", () => {
    expect(redactToken("")).toBe("(missing)");
    expect(redactToken("short")).toBe("***");
    expect(redactToken("123456:abcdef")).toBe("1234...cdef");
  });
});
