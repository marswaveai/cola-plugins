import type * as lark from "@larksuiteoapi/node-sdk";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { fetchBotOpenId } from "../src/api/client.js";

function makeLogger(): PluginLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("fetchBotOpenId", () => {
  it("returns the bot open_id from /open-apis/bot/v3/info", async () => {
    const request = vi.fn(async () => ({ bot: { open_id: "ou_bot" } }));
    const client = { request } as unknown as lark.Client;

    const openId = await fetchBotOpenId(client, makeLogger());

    expect(openId).toBe("ou_bot");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", url: "/open-apis/bot/v3/info" }),
    );
  });

  it("returns undefined and warns when the request fails", async () => {
    const request = vi.fn(async () => {
      throw new Error("network");
    });
    const client = { request } as unknown as lark.Client;
    const logger = makeLogger();

    const openId = await fetchBotOpenId(client, logger);

    expect(openId).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns undefined when the response has no bot open_id", async () => {
    const client = { request: vi.fn(async () => ({})) } as unknown as lark.Client;
    expect(await fetchBotOpenId(client, makeLogger())).toBeUndefined();
  });
});
