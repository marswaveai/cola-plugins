import { AccessTokenManager, type FetchLike } from "./token.js";
import type { DingTalkAccountConfig } from "./types.js";

const API_BASE = "https://api.dingtalk.com";
/** New-style REST host used by robot message send/download endpoints (x-acs-dingtalk-access-token header). */
const OAPI_BASE = "https://oapi.dingtalk.com";
/**
 * DingTalk rejects robot message payloads whose msgParam exceeds 15000 UTF-8 bytes.
 */
export const MAX_MSG_PARAM_BYTES = 15000;
/** Media upload size caps enforced by DingTalk's /media/upload endpoint. */
export const MAX_MEDIA_UPLOAD_BYTES = 20 * 1024 * 1024; // image/video/file ≤ 20MB; voice ≤ 2MB
const TRUNCATION_SUFFIX = "…(truncated)";

export type OutgoingMessage = {
  msgKey: string;
  msgParam: string;
};

/**
 * Build a plain-text robot message (`sampleText`).
 */
export function buildTextMessage(content: string): OutgoingMessage {
  return { msgKey: "sampleText", msgParam: JSON.stringify({ content }) };
}

/**
 * Build a markdown robot message (`sampleMarkdown`). The title is derived from
 * the first meaningful line and is used by DingTalk for notification previews.
 */
export function buildMarkdownMessage(text: string): OutgoingMessage {
  return {
    msgKey: "sampleMarkdown",
    msgParam: JSON.stringify({ title: markdownTitle(text), text }),
  };
}

/**
 * Build an image robot message (`sampleImageMsg`). DingTalk accepts either a
 * full https URL or a mediaId (returned by /media/upload). We always pass the
 * mediaId so the image renders natively inside the DingTalk client.
 */
export function buildImageMessage(mediaId: string): OutgoingMessage {
  return { msgKey: "sampleImageMsg", msgParam: JSON.stringify({ photoURL: mediaId }) };
}

/**
 * Build a file robot message (`sampleFile`). `fileType` is the lowercase
 * extension without the dot (xlsx, pdf, docx, …). DingTalk's file message
 * only supports a few office/archive formats; other files still upload fine
 * but may display with a generic icon.
 */
export function buildFileMessage(
  mediaId: string,
  fileName: string,
  fileType: string,
): OutgoingMessage {
  return { msgKey: "sampleFile", msgParam: JSON.stringify({ mediaId, fileName, fileType }) };
}

/**
 * Build a voice robot message (`sampleAudio`). Supported formats: ogg, amr.
 * `duration` is in milliseconds.
 */
export function buildVoiceMessage(mediaId: string, durationMs = 0): OutgoingMessage {
  return {
    msgKey: "sampleAudio",
    msgParam: JSON.stringify({ mediaId, duration: String(durationMs) }),
  };
}

/**
 * Build a video robot message (`sampleVideo`). `videoMediaId` must be an mp4
 * mediaId; `picMediaId` is the video cover image (also a mediaId).
 */
export function buildVideoMessage(
  videoMediaId: string,
  picMediaId: string,
  durationSec = 0,
): OutgoingMessage {
  return {
    msgKey: "sampleVideo",
    msgParam: JSON.stringify({
      duration: String(durationSec),
      videoMediaId,
      videoType: "mp4",
      picMediaId,
    }),
  };
}

function markdownTitle(text: string): string {
  const firstLine =
    text
      .split("\n")
      .map((line) => line.replace(/[#*_>`~[\]]/g, "").trim())
      .find(Boolean) ?? "";
  if (!firstLine) return "Cola";
  return firstLine.length > 20 ? `${firstLine.slice(0, 20)}…` : firstLine;
}

/**
 * Ensure the serialized msgParam stays within DingTalk's 15000-byte budget.
 * Oversized message text is truncated (UTF-8-safe via a binary search on the
 * character count) rather than rejected by the API.
 */
export function enforceMsgParamLimit(
  message: OutgoingMessage,
  maxBytes: number = MAX_MSG_PARAM_BYTES,
): OutgoingMessage {
  if (Buffer.byteLength(message.msgParam, "utf8") <= maxBytes) return message;

  const parsed = JSON.parse(message.msgParam) as Record<string, string>;
  const field = message.msgKey === "sampleText" ? "content" : "text";
  const original = typeof parsed[field] === "string" ? parsed[field] : "";
  if (!original) return message; // Nothing trimmable; let the API error surface.

  const fits = (length: number): boolean => {
    parsed[field] = `${original.slice(0, length)}${TRUNCATION_SUFFIX}`;
    return Buffer.byteLength(JSON.stringify(parsed), "utf8") <= maxBytes;
  };

  let lo = 0;
  let hi = original.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  fits(lo);

  return { msgKey: message.msgKey, msgParam: JSON.stringify(parsed) };
}

/**
 * Minimal DingTalk REST client for robot message sending. The Stream channel
 * is receive-only; all replies go through these REST endpoints with an access
 * token from the token manager. Tokens are only sent as a request header and
 * are never logged or embedded in error messages.
 */
export class DingTalkClient {
  constructor(
    private readonly tokenManager: AccessTokenManager,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** Direct-chat reply via /v1.0/robot/oToMessages/batchSend. */
  async sendOToMessage(
    robotCode: string,
    staffId: string,
    message: OutgoingMessage,
  ): Promise<void> {
    await this.request("/v1.0/robot/oToMessages/batchSend", {
      robotCode,
      userIds: [staffId],
      msgKey: message.msgKey,
      msgParam: message.msgParam,
    });
  }

  /** Group-chat reply via /v1.0/robot/groupMessages/send. */
  async sendGroupMessage(
    robotCode: string,
    openConversationId: string,
    message: OutgoingMessage,
  ): Promise<void> {
    await this.request("/v1.0/robot/groupMessages/send", {
      robotCode,
      openConversationId,
      msgKey: message.msgKey,
      msgParam: message.msgParam,
    });
  }

  /**
   * Upload a local media file and return the DingTalk mediaId.
   *
   * NOTE: DingTalk's media upload endpoint is a legacy OAPI gateway
   * (`https://oapi.dingtalk.com/media/upload`) that authenticates via an
   * `access_token` form/query field rather than the `x-acs-dingtalk-access-token`
   * header used by the newer `api.dingtalk.com` robot endpoints. The access
   * token is the same one issued by `/v1.0/oauth2/accessToken`, so the existing
   * token manager covers it (verified against official docs; there is no
   * newer REST-hosted upload API today).
   */
  async uploadMedia(filePath: string, mediaType: string, fileName?: string): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    let data: Uint8Array;
    try {
      data = await readFile(filePath);
    } catch (err) {
      throw new Error(
        `DingTalk media upload failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (data.byteLength > MAX_MEDIA_UPLOAD_BYTES) {
      throw new Error(
        `DingTalk media upload rejected: file exceeds the ${MAX_MEDIA_UPLOAD_BYTES} byte limit`,
      );
    }

    const token = await this.tokenManager.getToken();
    const form = new FormData();
    const name = fileName ?? filePath.split("/").pop() ?? "file";
    form.append("type", mediaType);
    // The `media` part carries the filename + MIME; `append(blob, name)` is the
    // browser-style FormData variant available in Node. We keep the Content-Type
    // generic and let DingTalk infer the media format from the filename extension.
    // Casting the Uint8Array to ArrayBuffer-typed view resolves the TS
    // ArrayBufferLike/ArrayBuffer variance mismatch.
    form.append(
      "media",
      new Blob([
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      ] as BlobPart[]),
      name,
    );

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${OAPI_BASE}/media/upload?access_token=${encodeURIComponent(token)}`,
        { method: "POST", body: form },
      );
    } catch (err) {
      throw new Error(
        `DingTalk media upload request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      errcode?: number | string;
      errmsg?: string;
      media_id?: string;
    };
    if (
      !response.ok ||
      (body.errcode !== undefined && Number(body.errcode) !== 0) ||
      !body.media_id
    ) {
      throw new Error(
        `DingTalk media upload failed (HTTP ${response.status}, errcode=${body.errcode}): ${body.errmsg ?? ""}`,
      );
    }
    return body.media_id;
  }

  /**
   * Resolve a robot-received message downloadCode into a temporary download URL.
   * The returned URL is short-lived and points at the file with a generic
   * extension; the caller should rename with the message's own extension.
   */
  async resolveMessageDownload(robotCode: string, downloadCode: string): Promise<string> {
    const token = await this.tokenManager.getToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_BASE}/v1.0/robot/messageFiles/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify({ downloadCode, robotCode }),
      });
    } catch (err) {
      throw new Error(
        `DingTalk message download request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(
        `DingTalk message download failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    const data = (await response.json().catch(() => ({}))) as { downloadUrl?: string };
    if (!data.downloadUrl) {
      throw new Error("DingTalk message download response is missing the downloadUrl field");
    }
    return data.downloadUrl;
  }

  /**
   * Download a robot-received file to a temp path. `downloadCode` and
   * `fileName` come from the inbound message payload. The temp file keeps the
   * original (sanitized) filename so the agent sees a meaningful attachment.
   */
  async downloadMessageFile(
    robotCode: string,
    downloadCode: string,
    fileName: string,
    opts?: { maxBytes?: number; signal?: AbortSignal },
  ): Promise<string> {
    const maxBytes = opts?.maxBytes ?? 50 * 1024 * 1024;
    const downloadUrl = await this.resolveMessageDownload(robotCode, downloadCode);

    let response: Response;
    try {
      response = await this.fetchImpl(downloadUrl, { signal: opts?.signal });
    } catch (err) {
      throw new Error(
        `DingTalk message file fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(
        `DingTalk message file download failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      throw new Error(`DingTalk message file exceeds the ${maxBytes} byte limit`);
    }

    const { mkdtemp, writeFile: write } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const data = await response.arrayBuffer();
    if (data.byteLength > maxBytes) {
      throw new Error(`DingTalk message file exceeds the ${maxBytes} byte limit`);
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), "cola-dingtalk-"));
    const safeName = sanitizeFileName(fileName || "message");
    const filePath = path.join(dir, safeName);
    await write(filePath, Buffer.from(data));
    return filePath;
  }

  async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    const token = await this.tokenManager.getToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `DingTalk API ${path} request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(
        `DingTalk API ${path} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return response.json().catch(() => undefined);
  }
}

type CachedEntry = {
  client: DingTalkClient;
  clientId: string;
  clientSecret: string;
};

/**
 * Sanitize an inbound file name for safe use as a temp download path: strip
 * path separators, shell metacharacters, and ASCII control characters, then
 * truncate the basename so an over-long name never throws ENAMETOOLONG on
 * write. Keeps the extension so the agent and the user can identify the file
 * type at a glance.
 */
export function sanitizeFileName(name: string): string {
  let base = name.replace(/[\\/:*?"<>|]/g, "_");
  // Strip ASCII control characters (0x00–0x1f plus DEL) separately — a range
  // in the char class above trips oxlint's no-control-regex.
  base = base
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  return truncateBasename(base.trim() || "message");
}

/** Max length for the basename portion (before the last extension segment). */
const MAX_BASENAME_LENGTH = 120;

/**
 * Truncate a file name's basename to `MAX_BASENAME_LENGTH` characters, keeping
 * the trailing extension segment intact. Applied after sanitization so no
 * caller can slip an over-long name (from any source) past the write — a bare
 * download token would otherwise exceed common filesystem name limits and
 * throw ENAMETOOLONG (mac APFS/HFS allow up to 255 UTF-8 bytes).
 */
function truncateBasename(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;
  if (stem.length <= MAX_BASENAME_LENGTH) return name;
  return `${stem.slice(0, MAX_BASENAME_LENGTH)}${ext}`;
}

const clientCache = new Map<string, CachedEntry>();

export function getDingTalkClient(
  accountId: string,
  config: DingTalkAccountConfig,
): DingTalkClient {
  const { clientId, clientSecret } = config;
  if (!clientId || !clientSecret) {
    throw new Error(`DingTalk account "${accountId}" missing clientId or clientSecret`);
  }

  const cached = clientCache.get(accountId);
  if (cached && cached.clientId === clientId && cached.clientSecret === clientSecret) {
    return cached.client;
  }

  const client = new DingTalkClient(new AccessTokenManager(clientId, clientSecret));
  clientCache.set(accountId, { client, clientId, clientSecret });
  return client;
}

export function clearClientCache(): void {
  clientCache.clear();
}
