import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import type { WebClient } from "@slack/web-api";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import type { SlackFile } from "./types.js";

/**
 * Download a Slack-hosted file to a temp path. Slack private URLs require the
 * bot token as a Bearer header; an HTML response means auth/scope problems
 * (Slack serves a login page instead of an error).
 */
export async function downloadSlackFile(
  file: SlackFile,
  botToken: string,
  logger: PluginLogger,
): Promise<string | undefined> {
  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    logger.warn(`Slack file ${file.id} has no private URL; missing files:read scope?`);
    return undefined;
  }

  let tmpPath: string | undefined;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!response.ok) {
      logger.warn(`Failed to download Slack file ${file.id}: HTTP ${response.status}`);
      return undefined;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      logger.warn(
        `Slack returned HTML for file ${file.id}; bot token likely lacks files:read scope`,
      );
      return undefined;
    }

    const tmpDir = path.join(os.tmpdir(), "cola-slack");
    fs.mkdirSync(tmpDir, { recursive: true });
    const safeName = sanitizeFileName(file.name ?? file.title ?? file.id);
    tmpPath = path.join(tmpDir, `${Date.now()}-${safeName}`);
    if (!response.body) {
      logger.warn(`Slack file ${file.id} has no response body`);
      return undefined;
    }
    await pipeline(
      Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
      fs.createWriteStream(tmpPath),
    );
    return tmpPath;
  } catch (err) {
    if (tmpPath) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // Best effort cleanup for partial downloads.
      }
    }
    logger.warn(
      `Failed to download Slack file ${file.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
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
    file: fs.createReadStream(opts.filePath),
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
  return base || "file";
}
