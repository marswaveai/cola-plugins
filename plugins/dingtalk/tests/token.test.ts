import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessTokenManager } from "../src/api/token.js";

const TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("AccessTokenManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests a token from the oauth2/accessToken endpoint with app credentials", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ accessToken: "tok-1", expireIn: 7200 }));
    const manager = new AccessTokenManager("test-appkey", "test-secret", fetchImpl);

    await expect(manager.getToken()).resolves.toBe("tok-1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TOKEN_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      appKey: "test-appkey",
      appSecret: "test-secret",
    });
  });

  it("caches the token within its validity window and never logs it", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ accessToken: "tok-1", expireIn: 7200 }));
    const manager = new AccessTokenManager("test-appkey", "test-secret", fetchImpl);

    await expect(manager.getToken()).resolves.toBe("tok-1");
    await expect(manager.getToken()).resolves.toBe("tok-1");
    await expect(manager.getToken()).resolves.toBe("tok-1");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent refreshes into a single request", async () => {
    let requests = 0;
    const fetchImpl = vi.fn(async () => {
      requests += 1;
      return jsonResponse({ accessToken: `tok-${requests}`, expireIn: 7200 });
    });
    const manager = new AccessTokenManager("test-appkey", "test-secret", fetchImpl);

    const [a, b, c] = await Promise.all([
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
    ]);
    expect(a).toBe("tok-1");
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("expires the cached token after the documented validity window and refreshes early", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ accessToken: "tok-1", expireIn: 7200 }));
    const manager = new AccessTokenManager("test-appkey", "test-secret", fetchImpl);

    await manager.getToken();

    // 7200s validity minus the 300s refresh margin = 6900s cached.
    vi.advanceTimersByTime(6899 * 1000);
    await manager.getToken();
    expect(fetchImpl).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(2 * 1000);
    fetchImpl.mockImplementation(async () =>
      jsonResponse({ accessToken: "tok-2", expireIn: 7200 }),
    );
    await expect(manager.getToken()).resolves.toBe("tok-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("clears the cache on demand", async () => {
    let requests = 0;
    const fetchImpl = vi.fn(async () => {
      requests += 1;
      return jsonResponse({ accessToken: `tok-${requests}`, expireIn: 7200 });
    });
    const manager = new AccessTokenManager("test-appkey", "test-secret", fetchImpl);

    await manager.getToken();
    manager.clear();
    await expect(manager.getToken()).resolves.toBe("tok-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when the response has no accessToken", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const manager = new AccessTokenManager("test-appkey", "test-secret", fetchImpl);
    await expect(manager.getToken()).rejects.toThrow("missing the accessToken field");
  });

  it("throws when the endpoint returns a non-2xx status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const manager = new AccessTokenManager("test-appkey", "test-secret", fetchImpl);
    await expect(manager.getToken()).rejects.toThrow("HTTP 500");
  });
});
