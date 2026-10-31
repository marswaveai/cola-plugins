import { describe, expect, it, vi } from "vitest";
import {
  DingTalkClient,
  MAX_MSG_PARAM_BYTES,
  buildMarkdownMessage,
  buildTextMessage,
  enforceMsgParamLimit,
} from "../src/api/client.js";
import { AccessTokenManager } from "../src/api/token.js";

function clientWithFetch(
  impl: (input: string, init?: RequestInit) => Promise<Response>,
): DingTalkClient {
  const tokenManager = new AccessTokenManager("test-appkey", "test-secret", impl);
  return new DingTalkClient(tokenManager, impl);
}

function tokenResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ accessToken: "test-token", expireIn: 7200 }),
  } as unknown as Response;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("message builders", () => {
  it("builds sampleText messages", () => {
    const message = buildTextMessage("hello");
    expect(message.msgKey).toBe("sampleText");
    expect(JSON.parse(message.msgParam)).toEqual({ content: "hello" });
  });

  it("builds sampleMarkdown messages with a derived title", () => {
    const message = buildMarkdownMessage("## Daily report\n\nAll good");
    expect(message.msgKey).toBe("sampleMarkdown");
    const parsed = JSON.parse(message.msgParam) as { title: string; text: string };
    expect(parsed.title).toBe("Daily report");
    expect(parsed.text).toBe("## Daily report\n\nAll good");
  });

  it("falls back to a default title for blank markdown", () => {
    const message = buildMarkdownMessage("");
    expect((JSON.parse(message.msgParam) as { title: string }).title).toBe("Cola");
  });
});

describe("enforceMsgParamLimit", () => {
  it("leaves messages within the byte budget untouched", () => {
    const message = buildTextMessage("hello");
    expect(enforceMsgParamLimit(message)).toBe(message);
  });

  it("truncates oversized ASCII text to fit the 15000-byte budget", () => {
    const original = "a".repeat(40000);
    const limited = enforceMsgParamLimit(buildTextMessage(original));
    expect(Buffer.byteLength(limited.msgParam, "utf8")).toBeLessThanOrEqual(MAX_MSG_PARAM_BYTES);
    const parsed = JSON.parse(limited.msgParam) as { content: string };
    expect(parsed.content.startsWith("aaa")).toBe(true);
    expect(parsed.content.endsWith("…(truncated)")).toBe(true);
    expect(parsed.content.length).toBeLessThan(original.length);
  });

  it("truncates oversized CJK text without producing invalid UTF-8", () => {
    const original = "钉".repeat(10000); // 3 bytes per char
    const limited = enforceMsgParamLimit(buildMarkdownMessage(original));
    expect(Buffer.byteLength(limited.msgParam, "utf8")).toBeLessThanOrEqual(MAX_MSG_PARAM_BYTES);
    const parsed = JSON.parse(limited.msgParam) as { title: string; text: string };
    expect(parsed.text.endsWith("…(truncated)")).toBe(true);
    expect(Buffer.byteLength(parsed.text, "utf8")).toBeLessThan(original.length * 3);
  });

  it("respects a custom byte limit", () => {
    const limited = enforceMsgParamLimit(buildTextMessage("x".repeat(1000)), 100);
    expect(Buffer.byteLength(limited.msgParam, "utf8")).toBeLessThanOrEqual(100);
  });
});

describe("DingTalkClient", () => {
  it("sends direct replies via oToMessages/batchSend with the access token header", async () => {
    const fetchImpl = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.endsWith("/v1.0/oauth2/accessToken")) return tokenResponse();
      if (input.endsWith("/v1.0/robot/oToMessages/batchSend")) return jsonResponse({ errcode: 0 });
      throw new Error(`unexpected url ${input}`);
    });
    const client = clientWithFetch(fetchImpl);

    await client.sendOToMessage("robot-1", "staff-9", buildTextMessage("dm body"));

    expect(fetchImpl).toHaveBeenCalledTimes(2); // token + send
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend");
    expect((init.headers as Record<string, string>)["x-acs-dingtalk-access-token"]).toBe(
      "test-token",
    );
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      robotCode: "robot-1",
      userIds: ["staff-9"],
      msgKey: "sampleText",
      msgParam: JSON.stringify({ content: "dm body" }),
    });
  });

  it("sends group replies via groupMessages/send with the open conversation id", async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input.endsWith("/v1.0/oauth2/accessToken") ? tokenResponse() : jsonResponse({ errcode: 0 }),
    );
    const client = clientWithFetch(fetchImpl);

    await client.sendGroupMessage("robot-1", "cid-group-1", buildMarkdownMessage("group body"));

    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.dingtalk.com/v1.0/robot/groupMessages/send");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      robotCode: "robot-1",
      openConversationId: "cid-group-1",
      msgKey: "sampleMarkdown",
      msgParam: expect.any(String),
    });
    const msgParam = JSON.parse(body.msgParam as string) as { title: string; text: string };
    expect(msgParam.text).toBe("group body");
  });

  it("throws a descriptive error for non-2xx responses without leaking the token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "forbidden" }, 403));
    const client = clientWithFetch(fetchImpl);

    await expect(
      client.sendOToMessage("robot-1", "staff-9", buildTextMessage("x")),
    ).rejects.toThrow(/HTTP 403/);
  });
});
