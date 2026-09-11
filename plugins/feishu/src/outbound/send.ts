import type * as lark from "@larksuiteoapi/node-sdk";
import type { PluginLogger, ReactionAction } from "@marswave/cola-plugin-sdk";
import { formatAsPost } from "./format.js";
import { uploadImage, uploadFile } from "../media/upload.js";
import type { ChatMap } from "../gateway/chat-map.js";

/**
 * Send a text message to a Feishu delivery target.
 * Uses post format with md tag for markdown support.
 */
export async function sendText(
  client: lark.Client,
  deliveryTo: string,
  text: string,
  chatMap: ChatMap,
  logger: PluginLogger,
): Promise<void> {
  const { receiveId, receiveIdType } = resolveReceiver(deliveryTo, chatMap);

  try {
    await client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        content: formatAsPost(text),
        msg_type: "post",
      },
    });
  } catch (err) {
    logger.error(`Failed to send text to ${deliveryTo}`, err);
    throw err;
  }
}

/**
 * Send a media file (image or file) to a Feishu delivery target.
 */
export async function sendMedia(
  client: lark.Client,
  deliveryTo: string,
  mediaType: string,
  filePath: string,
  chatMap: ChatMap,
  logger: PluginLogger,
): Promise<void> {
  const { receiveId, receiveIdType } = resolveReceiver(deliveryTo, chatMap);

  try {
    if (mediaType.startsWith("image/")) {
      const imageKey = await uploadImage(client, filePath, logger);
      if (!imageKey) throw new Error("Image upload failed");

      await client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          content: JSON.stringify({ image_key: imageKey }),
          msg_type: "image",
        },
      });
    } else {
      const fileKey = await uploadFile(client, filePath, logger);
      if (!fileKey) throw new Error("File upload failed");

      await client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          content: JSON.stringify({ file_key: fileKey }),
          msg_type: "file",
        },
      });
    }
  } catch (err) {
    logger.error(`Failed to send media to ${deliveryTo}`, err);
    throw err;
  }
}

/**
 * Add or remove a native Feishu reaction on an existing message.
 */
export async function sendReaction(
  client: lark.Client,
  messageId: string,
  emoji: string,
  action: ReactionAction,
  reactionId: string | undefined,
  logger: PluginLogger,
): Promise<void> {
  try {
    if (action === "remove") {
      if (!reactionId) throw new Error("reactionId is required to remove a Feishu reaction");
      await client.im.messageReaction.delete({
        path: {
          message_id: messageId,
          reaction_id: reactionId,
        },
      });
      return;
    }

    await client.im.messageReaction.create({
      path: { message_id: messageId },
      data: {
        reaction_type: {
          emoji_type: emoji,
        },
      },
    });
  } catch (err) {
    logger.error(`Failed to ${action} reaction ${emoji} on ${messageId}`, err);
    throw err;
  }
}

/**
 * Delivery targets reach the plugin in more than one shape: `chat:<chat_id>`,
 * `user:<open_id>`, or a bare Feishu id (`oc_...` / `ou_...`). Some delivery
 * paths — notably cron runs redelivered after a restart — hand over the raw chat
 * id with no prefix at all. Such a value must still be sent as a `chat_id`:
 * sending it as an `open_id` makes Feishu reject the message with
 * `99992361 open_id cross app`.
 */
export function normalizeDeliveryTarget(
  deliveryTo: string,
): { id: string; kind: "chat" | "user" } | undefined {
  const raw = deliveryTo.trim();
  if (!raw) return undefined;

  let prefixedKind: "chat" | "user" | undefined;
  let id = raw;
  if (raw.startsWith("chat:")) {
    prefixedKind = "chat";
    id = raw.slice("chat:".length);
  } else if (raw.startsWith("user:")) {
    prefixedKind = "user";
    id = raw.slice("user:".length);
  }
  if (!id) return undefined;

  // The id prefix is the source of truth: a chat id is never a valid open_id.
  if (id.startsWith("oc_")) return { id, kind: "chat" };
  if (id.startsWith("ou_")) return { id, kind: "user" };
  return { id, kind: prefixedKind ?? "user" };
}

export function resolveReceiver(
  deliveryTo: string,
  chatMap: ChatMap,
): { receiveId: string; receiveIdType: "chat_id" | "open_id" } {
  const target = normalizeDeliveryTarget(deliveryTo);
  if (!target) {
    return { receiveId: deliveryTo, receiveIdType: "open_id" };
  }
  if (target.kind === "chat") {
    return { receiveId: target.id, receiveIdType: "chat_id" };
  }

  const chatId = chatMap.get(target.id);
  if (chatId) {
    return { receiveId: chatId, receiveIdType: "chat_id" };
  }
  return { receiveId: target.id, receiveIdType: "open_id" };
}
