import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import {
  buildMarkdownMessage,
  buildImageMessage,
  buildFileMessage,
  buildVoiceMessage,
  enforceMsgParamLimit,
} from "../api/client.js";
import type { DingTalkClient, OutgoingMessage } from "../api/client.js";

/**
 * Send a Cola reply to a DingTalk delivery target.
 *
 * Targets follow the inbound session convention: `staff:<senderStaffId>` for
 * direct chats (oToMessages) and `conversation:<conversationId>` for group
 * chats (groupMessages). Replies are sent as markdown robot messages; the
 * msgParam is guarded against DingTalk's 15000-byte limit.
 */
export async function sendText(
  client: DingTalkClient,
  deliveryTo: string,
  text: string,
  robotCode: string | undefined,
  logger: PluginLogger,
): Promise<void> {
  if (!robotCode) {
    throw new Error("DingTalk robotCode is not known yet; unable to send");
  }

  const message = enforceMsgParamLimit(buildMarkdownMessage(text));

  try {
    if (deliveryTo.startsWith("staff:")) {
      await client.sendOToMessage(robotCode, deliveryTo.slice("staff:".length), message);
      return;
    }
    if (deliveryTo.startsWith("conversation:")) {
      await client.sendGroupMessage(robotCode, deliveryTo.slice("conversation:".length), message);
      return;
    }
    throw new Error(`Unsupported DingTalk delivery target: ${deliveryTo}`);
  } catch (err) {
    logger.error(`Failed to send text to ${deliveryTo}`, err);
    throw err;
  }
}

/**
 * Route a media dispatch to the correct DingTalk robot message type.
 *
 * - image  → upload → `sampleImageMsg` (photoURL = mediaId)
 * - audio  → upload → `sampleAudio`  (mediaId + duration)
 * - file   → upload → `sampleFile`   (mediaId + fileName + fileType)
 * - video  → not supported here: DingTalk's `sampleVideo` requires a separate
 *   cover image mediaId (picMediaId) that cannot be derived from a single file,
 *   so the adapter reports it as unsupported rather than half-sending.
 *
 * Uploads go through the same access token as normal sends (see uploadMedia in
 * api/client.ts for the OAPI domain + access_token note).
 */
export async function sendMedia(
  client: DingTalkClient,
  deliveryTo: string,
  mediaType: string,
  filePath: string,
  robotCode: string | undefined,
  logger: PluginLogger,
): Promise<void> {
  if (!robotCode) {
    throw new Error("DingTalk robotCode is not known yet; unable to send media");
  }
  if (!isSendableMediaType(mediaType)) {
    throw new Error(`DingTalk media send unsupported for MIME type: ${mediaType}`);
  }

  const fileName = filePath.split("/").pop() ?? "file";
  let message: OutgoingMessage;

  try {
    if (mediaType.startsWith("image/")) {
      const mediaId = await client.uploadMedia(filePath, "image", fileName);
      message = buildImageMessage(mediaId);
    } else if (mediaType.startsWith("audio/")) {
      const mediaId = await client.uploadMedia(filePath, "voice", fileName);
      message = buildVoiceMessage(mediaId);
    } else {
      const fileType = extWithoutDot(fileName);
      const mediaId = await client.uploadMedia(filePath, "file", fileName);
      message = buildFileMessage(mediaId, fileName, fileType);
    }

    if (deliveryTo.startsWith("staff:")) {
      await client.sendOToMessage(robotCode, deliveryTo.slice("staff:".length), message);
      return;
    }
    if (deliveryTo.startsWith("conversation:")) {
      await client.sendGroupMessage(robotCode, deliveryTo.slice("conversation:".length), message);
      return;
    }
    throw new Error(`Unsupported DingTalk delivery target: ${deliveryTo}`);
  } catch (err) {
    logger.error(`Failed to send media (${mediaType}) to ${deliveryTo}`, err);
    throw err;
  }
}

/** Media types DingTalk robot messages can actually send (image/audio/file). */
function isSendableMediaType(mediaType: string): boolean {
  return (
    mediaType.startsWith("image/") ||
    mediaType.startsWith("audio/") ||
    mediaType.startsWith("file/") ||
    mediaType === "application/pdf" ||
    mediaType.includes("document") ||
    mediaType.includes("spreadsheet") ||
    mediaType.includes("presentation") ||
    mediaType.includes("zip") ||
    mediaType.includes("rar")
  );
}

/** Lowercase file extension without the leading dot, e.g. "xlsx". */
function extWithoutDot(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0 || idx === fileName.length - 1) return "file";
  return fileName.slice(idx + 1).toLowerCase();
}
