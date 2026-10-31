import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import { createHash } from "node:crypto";
import type { DingTalkClient } from "../api/client.js";
import type { ParsedRobotMessage } from "./message.js";

/** Local download size cap for inbound robot media (matches the plugin note). */
export const MAX_MEDIA_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Download a robot-received media message to a local temp path so the agent
 * can consume the real file instead of a text summary.
 *
 * Returns the temp path on success, or `undefined` on any failure —
 * downloading must never block message delivery, so the caller keeps the text
 * summary as a fallback. The downloaded file is owned by the host once the
 * message is delivered (it takes custody of the `attachments` array); on
 * failure the path is cleaned up here.
 */
export async function downloadRobotMessageMedia(
  client: DingTalkClient,
  parsed: ParsedRobotMessage,
  logger: PluginLogger,
): Promise<string | undefined> {
  const { downloadCode, fileName } = parsed.media ?? {};
  const robotCode = parsed.robotCode;
  if (!downloadCode || !robotCode) {
    logger.warn("DingTalk media message missing downloadCode or robotCode, skipping download");
    return undefined;
  }

  const fallbackName = fileName ?? mediaFallbackName(downloadCode, parsed.media?.kind ?? "unknown");
  try {
    const path = await client.downloadMessageFile(robotCode, downloadCode, fallbackName, {
      maxBytes: MAX_MEDIA_DOWNLOAD_BYTES,
    });
    logger.info(`Downloaded DingTalk ${parsed.media?.kind ?? "media"} message media to ${path}`);
    return path;
  } catch (err) {
    logger.warn(
      `Failed to download DingTalk ${parsed.media?.kind ?? "media"} message media: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}

/**
 * Build a safe file name when the message carries no real `fileName`. The
 * downloadCode is a long base64-ish token (image messages have no name), so
 * reusing it verbatim would exceed common filesystem limits and throw
 * ENAMETOOLONG. Instead derive a short deterministic name from a sha256 hash of
 * the code plus an extension inferred from the media kind. The resulting name
 * is short (16 hex chars + extension) and never contains the code itself.
 */
function mediaFallbackName(downloadCode: string, kind: string): string {
  const hash = sha256Hex(downloadCode).slice(0, 16);
  return `${hash}${mediaExtension(kind)}`;
}

/** sha256 of a string, hex-encoded. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function mediaExtension(kind: string): string {
  switch (kind) {
    case "image":
      return ".jpg";
    case "audio":
      return ".amr";
    case "video":
      return ".mp4";
    default:
      return "";
  }
}
