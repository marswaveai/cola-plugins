import type * as lark from '@larksuiteoapi/node-sdk'
import type { PluginLogger } from 'cola-plugin-sdk'
import type { FeishuMessageEvent, FeishuPostContent, FeishuPostElement } from '../api/types.js'
import { downloadMessageResource } from '../media/download.js'

export type ParsedMessage = {
  text: string
  attachments: string[]
}

/**
 * Parse Feishu message content into text + attachments.
 */
export async function parseMessage(
  event: FeishuMessageEvent,
  client: lark.Client,
  logger: PluginLogger,
): Promise<ParsedMessage> {
  const { message_type, content, message_id } = event.message
  const attachments: string[] = []

  switch (message_type) {
    case 'text': {
      const parsed = JSON.parse(content) as { text: string }
      return { text: parsed.text, attachments }
    }

    case 'post': {
      const parsed = JSON.parse(content) as Record<string, FeishuPostContent>
      // Try zh_cn first, then en_us, then first available language
      const post = parsed.zh_cn ?? parsed.en_us ?? Object.values(parsed)[0]
      if (!post) return { text: '', attachments }

      const lines: string[] = []
      if (post.title) lines.push(post.title)

      for (const paragraph of post.content) {
        const parts: string[] = []
        for (const elem of paragraph) {
          parts.push(postElementToText(elem))
        }
        lines.push(parts.join(''))
      }

      return { text: lines.join('\n'), attachments }
    }

    case 'image': {
      const parsed = JSON.parse(content) as { image_key: string }
      const filePath = await downloadMessageResource(client, message_id, parsed.image_key, 'image', `${parsed.image_key}.png`, logger)
      if (filePath) attachments.push(filePath)
      return { text: '', attachments }
    }

    case 'file': {
      const parsed = JSON.parse(content) as { file_key: string; file_name: string }
      const filePath = await downloadMessageResource(client, message_id, parsed.file_key, 'file', parsed.file_name, logger)
      if (filePath) attachments.push(filePath)
      return { text: `[File: ${parsed.file_name}]`, attachments }
    }

    case 'audio':
    case 'video':
    case 'sticker':
      logger.info(`Unsupported message type: ${message_type}, skipping`)
      return { text: `[Unsupported: ${message_type}]`, attachments }

    default:
      logger.info(`Unknown message type: ${message_type}`)
      return { text: `[Unknown: ${message_type}]`, attachments }
  }
}

function postElementToText(elem: FeishuPostElement): string {
  switch (elem.tag) {
    case 'text': return elem.text
    case 'a': return `[${elem.text}](${elem.href})`
    case 'at': return `@${elem.user_name ?? elem.user_id}`
    case 'img': return '[image]'
    case 'md': return elem.text
    default: return ''
  }
}
