import type * as lark from "@larksuiteoapi/node-sdk";
import { describe, expect, it, vi } from "vitest";
import { fetchBotOpenId } from "../src/api/client.js";

describe("fetchBotOpenId", () => {
  it("returns the bot open_id from /open-apis/bot/v3/info", async () => {
    const request = vi.fn(async () => ({ bot: { open_id: "ou_bot" } }));
    const client = { request } as unknown as lark.Client;

    const openId = await fetchBotOpenId(client);

    expect(openId).toBe("ou_bot");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", url: "/open-apis/bot/v3/info" }),
    );
  });

  it("preserves request failures for connection diagnostics", async () => {
    const request = vi.fn(async () => {
      throw new Error("network");
    });
    const client = { request } as unknown as lark.Client;
    await expect(fetchBotOpenId(client)).rejects.toThrow("network");
  });

  it("returns undefined when the response has no bot open_id", async () => {
    const client = { request: vi.fn(async () => ({})) } as unknown as lark.Client;
    expect(await fetchBotOpenId(client)).toBeUndefined();
  });
});
