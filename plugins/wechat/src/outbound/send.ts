import type { PluginLogger } from '@cola/plugin-sdk'
import type { WeixinApiOptions } from '../api/client.js'
import { sendMessage as sendMessageApi } from '../api/client.js'
import type { MessageItem, SendMessageReq } from '../api/types.js'
import { MessageItemType, MessageState, MessageType } from '../api/types.js'
import type { UploadedFileInfo } from '../cdn/upload.js'
import { generateId } from '../util/random.js'

export { StreamingMarkdownFilter } from './markdown-filter.js'

function generateClientId(): string {
  return generateId('cola-wechat')
}

function buildTextMessageReq(params: {
  to: string
  text: string
  contextToken?: string
  clientId: string
}): SendMessageReq {
  const { to, text, contextToken, clientId } = params
  const item_list: MessageItem[] = text
    ? [{ type: MessageItemType.TEXT, text_item: { text } }]
    : []
  return {
    msg: {
      from_user_id: '',
      to_user_id: to,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: item_list.length ? item_list : undefined,
      context_token: contextToken ?? undefined,
    },
  }
}

export async function sendMessageWeixin(params: {
  to: string
  text: string
  opts: WeixinApiOptions & { contextToken?: string }
  log: PluginLogger
}): Promise<{ messageId: string }> {
  const { to, text, opts, log } = params
  const clientId = generateClientId()
  const req = buildTextMessageReq({ to, text, contextToken: opts.contextToken, clientId })
  try {
    await sendMessageApi({ baseUrl: opts.baseUrl, token: opts.token, timeoutMs: opts.timeoutMs, body: req })
  } catch (err) {
    log.error(`sendMessageWeixin: failed to=${to} clientId=${clientId} err=${String(err)}`)
    throw err
  }
  return { messageId: clientId }
}

async function sendMediaItems(params: {
  to: string
  text: string
  mediaItem: MessageItem
  opts: WeixinApiOptions & { contextToken?: string }
  label: string
  log: PluginLogger
}): Promise<{ messageId: string }> {
  const { to, text, mediaItem, opts, label, log } = params
  const items: MessageItem[] = []
  if (text) items.push({ type: MessageItemType.TEXT, text_item: { text } })
  items.push(mediaItem)

  let lastClientId = ''
  for (const item of items) {
    lastClientId = generateClientId()
    const req: SendMessageReq = {
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: lastClientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [item],
        context_token: opts.contextToken ?? undefined,
      },
    }
    try {
      await sendMessageApi({ baseUrl: opts.baseUrl, token: opts.token, timeoutMs: opts.timeoutMs, body: req })
    } catch (err) {
      log.error(`${label}: failed to=${to} clientId=${lastClientId} err=${String(err)}`)
      throw err
    }
  }
  return { messageId: lastClientId }
}

export async function sendImageMessageWeixin(params: {
  to: string
  text: string
  uploaded: UploadedFileInfo
  opts: WeixinApiOptions & { contextToken?: string }
  log: PluginLogger
}): Promise<{ messageId: string }> {
  const { to, text, uploaded, opts, log } = params
  const imageItem: MessageItem = {
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        // aeskey is a hex string — iLink expects base64 of the raw hex chars, not decoded bytes
        aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
        encrypt_type: 1,
      },
      mid_size: uploaded.fileSizeCiphertext,
    },
  }
  return sendMediaItems({ to, text, mediaItem: imageItem, opts, label: 'sendImage', log })
}

export async function sendVideoMessageWeixin(params: {
  to: string
  text: string
  uploaded: UploadedFileInfo
  opts: WeixinApiOptions & { contextToken?: string }
  log: PluginLogger
}): Promise<{ messageId: string }> {
  const { to, text, uploaded, opts, log } = params
  const videoItem: MessageItem = {
    type: MessageItemType.VIDEO,
    video_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        // aeskey is a hex string — iLink expects base64 of the raw hex chars, not decoded bytes
        aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
        encrypt_type: 1,
      },
      video_size: uploaded.fileSizeCiphertext,
    },
  }
  return sendMediaItems({ to, text, mediaItem: videoItem, opts, label: 'sendVideo', log })
}

export async function sendFileMessageWeixin(params: {
  to: string
  text: string
  fileName: string
  uploaded: UploadedFileInfo
  opts: WeixinApiOptions & { contextToken?: string }
  log: PluginLogger
}): Promise<{ messageId: string }> {
  const { to, text, fileName, uploaded, opts, log } = params
  const fileItem: MessageItem = {
    type: MessageItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        // aeskey is a hex string — iLink expects base64 of the raw hex chars, not decoded bytes
        aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
        encrypt_type: 1,
      },
      file_name: fileName,
      len: String(uploaded.fileSize),
    },
  }
  return sendMediaItems({ to, text, mediaItem: fileItem, opts, label: 'sendFile', log })
}
