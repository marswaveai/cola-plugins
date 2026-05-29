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

function resolveReceiver(
  deliveryTo: string,
  chatMap: ChatMap,
): { receiveId: string; receiveIdType: "chat_id" | "open_id" } {
  if (deliveryTo.startsWith("chat:")) {
    return { receiveId: deliveryTo.slice("chat:".length), receiveIdType: "chat_id" };
  }

  const openId = deliveryTo.startsWith("user:") ? deliveryTo.slice("user:".length) : deliveryTo;
  const chatId = chatMap.get(openId);
  if (chatId) {
    return { receiveId: chatId, receiveIdType: "chat_id" };
  }
  return { receiveId: openId, receiveIdType: "open_id" };
}
