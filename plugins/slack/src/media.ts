import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "os";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import type { WebClient } from "@slack/web-api";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import type { SlackFile } from "./types.js";

type SlackDownloadOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Download a Slack-hosted file to a temp path. Slack private URLs require the
 * bot token as a Bearer header. Unexpected HTML can be a login page.
 */
export async function downloadSlackFile(
  file: SlackFile,
  botToken: string,
  logger: PluginLogger,
  options: SlackDownloadOptions = {},
): Promise<string | undefined> {
  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    logger.warn(`Slack file ${file.id} has no private URL; missing files:read scope?`);
    return undefined;
  }

  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response | undefined;
  let tmpPath: string | undefined;
  try {
    signal.throwIfAborted();
    if (file.size !== undefined && file.size > maxBytes) {
      throw new Error(`File exceeds the ${maxBytes} byte download limit`);
    }
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal,
    });
    if (!response.ok) {
      logger.warn(`Failed to download Slack file ${file.id}: HTTP ${response.status}`);
      return undefined;
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const attachment = /^attachment(?:;|$)/i.test(
      response.headers.get("content-disposition")?.trim() ?? "",
    );
    const declaredHtml =
      file.mimetype?.split(";")[0].trim().toLowerCase() === "text/html" || file.filetype === "html";
    const loginPage =
      response.url && /\/(?:signin|sign_in|login)(?:\/|$)/i.test(new URL(response.url).pathname);
    if (contentType.includes("text/html") && (loginPage || (!attachment && !declaredHtml))) {
      logger.warn(
        `Slack returned HTML for file ${file.id}; bot token likely lacks files:read scope`,
      );
      return undefined;
    }

    if (Number(response.headers.get("content-length")) > maxBytes) {
      throw new Error(`File exceeds the ${maxBytes} byte download limit`);
    }
    if (!response.body) {
      logger.warn(`Slack file ${file.id} has no response body`);
      return undefined;
    }
    const tmpDir = path.join(os.tmpdir(), "cola-slack");
    await mkdir(tmpDir, { recursive: true });
    const safeName = sanitizeFileName(file.name ?? file.title ?? file.id);
    tmpPath = path.join(tmpDir, `${randomUUID()}-${safeName}`);
    let downloadedBytes = 0;
    await pipeline(
      Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          downloadedBytes += chunk.length;
          if (downloadedBytes > maxBytes) {
            callback(new Error(`File exceeds the ${maxBytes} byte download limit`));
          } else {
            callback(null, chunk);
          }
        },
      }),
      createWriteStream(tmpPath),
      { signal },
    );
    return tmpPath;
  } catch (err) {
    if (tmpPath) {
      try {
        await rm(tmpPath, { force: true });
      } catch {
        // Best effort cleanup for partial downloads.
      }
    }
    logger.warn(
      `Failed to download Slack file ${file.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  } finally {
    if (response?.body && !response.body.locked) {
      await response.body.cancel().catch(() => {});
    }
  }
}

export async function uploadSlackFile(
  client: WebClient,
  opts: {
    channelId: string;
    filePath: string;
    threadTs?: string;
    comment?: string;
  },
): Promise<void> {
  const base = {
    channel_id: opts.channelId,
    file: createReadStream(opts.filePath),
    filename: path.basename(opts.filePath),
    ...(opts.comment ? { initial_comment: opts.comment } : {}),
  };
  if (opts.threadTs) {
    await client.filesUploadV2({ ...base, thread_ts: opts.threadTs });
  } else {
    await client.filesUploadV2(base);
  }
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.()\- ]+/g, "_");
  // Sanitization is ASCII-only; reserve 37 bytes for the UUID and separator.
  const maxBytes = 255 - 37;
  if (base.length <= maxBytes) return base || "file";
  const extension = path.extname(base);
  const suffix = extension.slice(0, 32);
  return base.slice(0, Math.min(base.length - extension.length, maxBytes - suffix.length)) + suffix;
}
