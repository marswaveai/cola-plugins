import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DingTalkClient,
  MAX_MEDIA_UPLOAD_BYTES,
  buildImageMessage,
  buildFileMessage,
  buildVoiceMessage,
  buildVideoMessage,
  sanitizeFileName,
} from "../src/api/client.js";
import { AccessTokenManager } from "../src/api/token.js";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cola-dingtalk-media-test-"));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

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

async function writeTmp(name: string, contents: string): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, contents);
  return filePath;
}

describe("media message builders", () => {
  it("builds sampleImageMsg with the mediaId as photoURL", () => {
    const message = buildImageMessage("@media-1");
    expect(message.msgKey).toBe("sampleImageMsg");
    expect(JSON.parse(message.msgParam)).toEqual({ photoURL: "@media-1" });
  });

  it("builds sampleFile with mediaId/fileName/fileType", () => {
    const message = buildFileMessage("@media-2", "report.xlsx", "xlsx");
    expect(message.msgKey).toBe("sampleFile");
    expect(JSON.parse(message.msgParam)).toEqual({
      mediaId: "@media-2",
      fileName: "report.xlsx",
      fileType: "xlsx",
    });
  });

  it("builds sampleAudio with a numeric duration string", () => {
    const message = buildVoiceMessage("@media-3", 1500);
    expect(message.msgKey).toBe("sampleAudio");
    expect(JSON.parse(message.msgParam)).toEqual({
      mediaId: "@media-3",
      duration: "1500",
    });
  });

  it("builds sampleVideo with both media ids", () => {
    const message = buildVideoMessage("@video", "@cover", 9);
    expect(message.msgKey).toBe("sampleVideo");
    expect(JSON.parse(message.msgParam)).toEqual({
      duration: "9",
      videoMediaId: "@video",
      videoType: "mp4",
      picMediaId: "@cover",
    });
  });
});

describe("sanitizeFileName", () => {
  it("strips path separators and shell metacharacters", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeFileName("a:b*c?d.txt")).toBe("a_b_c_d.txt");
    expect(sanitizeFileName("report.pdf")).toBe("report.pdf");
  });

  it("falls back to a default name when the input is empty", () => {
    expect(sanitizeFileName("")).toBe("message");
    expect(sanitizeFileName("   ")).toBe("message");
  });

  it("truncates an over-long basename while keeping the extension", () => {
    const long = `a${"x".repeat(300)}.png`;
    const safe = sanitizeFileName(long);
    expect(safe.length).toBeLessThanOrEqual(200);
    expect(safe.endsWith(".png")).toBe(true);
    expect(safe.length).toBe(120 + 4); // 120-char stem + ".png"
  });

  it("leaves a normal-length name untouched", () => {
    expect(sanitizeFileName("report.pdf")).toBe("report.pdf");
  });
});

describe("DingTalkClient.uploadMedia", () => {
  it("uploads via the OAPI gateway with an access_token form field and returns media_id", async () => {
    const filePath = await writeTmp("pic.png", "fake-png-bytes");
    const fetchImpl = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.endsWith("/v1.0/oauth2/accessToken")) return tokenResponse();
      if (input.startsWith("https://oapi.dingtalk.com/media/upload"))
        return jsonResponse({ errcode: 0, errmsg: "ok", media_id: "@up-media-1" });
      throw new Error(`unexpected url ${input}`);
    });
    const client = new DingTalkClient(
      new AccessTokenManager("app", "secret", fetchImpl),
      fetchImpl,
    );

    const mediaId = await client.uploadMedia(filePath, "image");

    expect(mediaId).toBe("@up-media-1");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // token + upload
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit | undefined];
    expect(url.startsWith("https://oapi.dingtalk.com/media/upload?access_token=test-token")).toBe(
      true,
    );
    const form = init?.body as FormData;
    expect(form.has("media")).toBe(true);
    expect(form.get("type")).toBe("image");
  });

  it("throws when the file exceeds the DingTalk upload limit", async () => {
    const bigFile = path.join(tmpDir, "big.bin");
    await fs.writeFile(bigFile, Buffer.alloc(MAX_MEDIA_UPLOAD_BYTES + 1));
    const fetchImpl = vi.fn(async () => tokenResponse());
    const client = new DingTalkClient(
      new AccessTokenManager("app", "secret", fetchImpl),
      fetchImpl,
    );

    await expect(client.uploadMedia(bigFile, "file")).rejects.toThrow(/limit/);
    // No token was even needed since the size gate fires first.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a descriptive error when the upload API reports a non-zero errcode", async () => {
    const filePath = await writeTmp("doc.pdf", "pdf");
    const fetchImpl = vi.fn(async (input: string) =>
      input.endsWith("/v1.0/oauth2/accessToken")
        ? tokenResponse()
        : jsonResponse({ errcode: 40035, errmsg: "invalid media type" }),
    );
    const client = new DingTalkClient(
      new AccessTokenManager("app", "secret", fetchImpl),
      fetchImpl,
    );

    await expect(client.uploadMedia(filePath, "file", "doc.pdf")).rejects.toThrow(/40035/);
  });

  it("does not leak the token into the thrown error", async () => {
    const filePath = await writeTmp("doc.pdf", "pdf");
    const fetchImpl = vi.fn(async () => jsonResponse({ errcode: 500 }, 500));
    const client = new DingTalkClient(
      new AccessTokenManager("app", "secret", fetchImpl),
      fetchImpl,
    );

    try {
      await client.uploadMedia(filePath, "file", "doc.pdf");
      throw new Error("expected uploadMedia to throw");
    } catch (err) {
      expect(String(err)).not.toContain("test-token");
    }
  });
});

describe("DingTalkClient.resolveMessageDownload / downloadMessageFile", () => {
  it("exchanges a downloadCode for a temp download URL", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.endsWith("/v1.0/oauth2/accessToken")) return tokenResponse();
      if (input.endsWith("/v1.0/robot/messageFiles/download"))
        return jsonResponse({ downloadUrl: "https://tmp.example/file.video" });
      throw new Error(`unexpected url ${input}`);
    });
    const client = new DingTalkClient(
      new AccessTokenManager("app", "secret", fetchImpl),
      fetchImpl,
    );

    const url = await client.resolveMessageDownload("robot-1", "code-1");

    expect(url).toBe("https://tmp.example/file.video");
    const [, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-acs-dingtalk-access-token"]).toBe(
      "test-token",
    );
    expect(JSON.parse(String(init.body))).toEqual({ downloadCode: "code-1", robotCode: "robot-1" });
  });

  it("downloads the resolved URL to a temp file with the sanitized name", async () => {
    const filePath = await writeTmp("inbox.pdf", "dummy-pdf");
    const body = await fs.readFile(filePath);
    const downloadUrl = "https://tmp.example/original";
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.endsWith("/v1.0/oauth2/accessToken")) return tokenResponse();
      if (input.endsWith("/v1.0/robot/messageFiles/download")) return jsonResponse({ downloadUrl });
      if (input === downloadUrl)
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => (n === "content-length" ? String(body.length) : null) },
          arrayBuffer: async () => body.buffer,
          text: async () => "dummy-pdf",
        } as unknown as Response;
      throw new Error(`unexpected url ${input}`);
    });
    const client = new DingTalkClient(
      new AccessTokenManager("app", "secret", fetchImpl),
      fetchImpl,
    );

    const out = await client.downloadMessageFile("robot-1", "code-1", "inbox.pdf");

    expect(path.basename(out)).toBe("inbox.pdf");
    expect(await fs.readFile(out, "utf8")).toBe("dummy-pdf");
    await fs.rm(path.dirname(out), { recursive: true, force: true });
  });

  it("rejects when the resolved download is over the byte limit", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.endsWith("/v1.0/oauth2/accessToken")) return tokenResponse();
      if (input.endsWith("/v1.0/robot/messageFiles/download"))
        return jsonResponse({ downloadUrl: "https://tmp.example/big" });
      if (input === "https://tmp.example/big") {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => (n === "content-length" ? "99999" : null) },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response;
      }
      throw new Error(`unexpected url ${input}`);
    });
    const client = new DingTalkClient(
      new AccessTokenManager("app", "secret", fetchImpl),
      fetchImpl,
    );

    await expect(
      client.downloadMessageFile("robot-1", "code-1", "big.bin", { maxBytes: 10 }),
    ).rejects.toThrow(/limit/);
  });

  it("survives an over-long downloadCode: writes a short derived filename", async () => {
    const downloadUrl = "https://tmp.example/pic";
    const body = await fs.readFile(await writeTmp("blob", "img-bytes"));
    const longCode = `mIofN681YE3f_+m+NntqpT_Xb989by3Wk+raappFh6IDZWpC7EkwrPh${"A".repeat(500)}`;
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.endsWith("/v1.0/oauth2/accessToken")) return tokenResponse();
      if (input.endsWith("/v1.0/robot/messageFiles/download")) return jsonResponse({ downloadUrl });
      if (input === downloadUrl)
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => (n === "content-length" ? String(body.length) : null) },
          arrayBuffer: async () => body.buffer,
        } as unknown as Response;
      throw new Error(`unexpected url ${input}`);
    });
    const client = new DingTalkClient(
      new AccessTokenManager("app", "secret", fetchImpl),
      fetchImpl,
    );

    // Pass the raw long code as the fileName to prove sanitizeFileName clamps it.
    const out = await client.downloadMessageFile("robot-1", longCode, longCode);

    const base = path.basename(out);
    expect(base.length).toBeLessThanOrEqual(120);
    expect(base).not.toContain(longCode);
    expect(await fs.readFile(out, "utf8")).toBe("img-bytes");
    await fs.rm(path.dirname(out), { recursive: true, force: true });
  });
});
