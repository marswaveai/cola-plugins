import type * as lark from '@larksuiteoapi/node-sdk'
import type { PluginLogger } from 'cola-plugin-sdk'
import { formatAsPost } from './format.js'
import { uploadImage, uploadFile } from '../media/upload.js'
import type { ChatMap } from '../gateway/chat-map.js'

/**
 * Send a text message to a Feishu user.
 * Uses post format with md tag for markdown support.
 */
export async function sendText(
  client: lark.Client,
  channelUserId: string,
  text: string,
  chatMap: ChatMap,
  logger: PluginLogger,
): Promise<void> {
  const { receiveId, receiveIdType } = resolveReceiver(channelUserId, chatMap)

  try {
    await client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        content: formatAsPost(text),
        msg_type: 'post',
      },
    })
  } catch (err) {
    logger.error(`Failed to send text to ${channelUserId}`, err)
    throw err
  }
}

/**
 * Send a media file (image or file) to a Feishu user.
 */
export async function sendMedia(
  client: lark.Client,
  channelUserId: string,
  mediaType: string,
  filePath: string,
  chatMap: ChatMap,
  logger: PluginLogger,
): Promise<void> {
  const { receiveId, receiveIdType } = resolveReceiver(channelUserId, chatMap)

  try {
    if (mediaType.startsWith('image/')) {
      const imageKey = await uploadImage(client, filePath, logger)
      if (!imageKey) throw new Error('Image upload failed')

      await client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          content: JSON.stringify({ image_key: imageKey }),
          msg_type: 'image',
        },
      })
    } else {
      const fileKey = await uploadFile(client, filePath, logger)
      if (!fileKey) throw new Error('File upload failed')

      await client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          content: JSON.stringify({ file_key: fileKey }),
          msg_type: 'file',
        },
      })
    }
  } catch (err) {
    logger.error(`Failed to send media to ${channelUserId}`, err)
    throw err
  }
}

function resolveReceiver(channelUserId: string, chatMap: ChatMap): { receiveId: string; receiveIdType: 'chat_id' | 'open_id' } {
  const chatId = chatMap.get(channelUserId)
  if (chatId) {
    return { receiveId: chatId, receiveIdType: 'chat_id' }
  }
  return { receiveId: channelUserId, receiveIdType: 'open_id' }
}
