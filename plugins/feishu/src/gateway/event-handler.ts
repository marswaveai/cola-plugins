import type * as lark from '@larksuiteoapi/node-sdk'
import type { PluginLogger, DeliverFn } from 'cola-plugin-sdk'
import { parseMessage } from './message-parser.js'
import { stripBotMention } from '../util/mention.js'
import { MessageDedup } from './dedup.js'
import type { ChatMap } from './chat-map.js'

export type EventHandlerDeps = {
  client: lark.Client
  accountId: string
  logger: PluginLogger
  deliver: DeliverFn
  dedup: MessageDedup
  chatMap: ChatMap
  botOpenId?: string
}

/**
 * Register the im.message.receive_v1 event handler on a dispatcher.
 */
export function registerMessageHandler(
  dispatcher: lark.EventDispatcher,
  deps: EventHandlerDeps,
): void {
  dispatcher.register({
    'im.message.receive_v1': async (data) => {
      // SDK v1 passes event data flat (not wrapped in .event)
      const { message, sender } = data
      const { accountId, logger, deliver, dedup, chatMap, client } = deps

      // Dedup
      if (dedup.isDuplicate(message.message_id)) {
        return {}
      }

      const senderId = sender.sender_id?.open_id
      if (!senderId) {
        logger.warn('Message missing sender open_id, skipping')
        return {}
      }

      // Record chat mapping
      chatMap.set(senderId, message.chat_id)

      // Parse message content
      const parsed = await parseMessage(
        {
          message: {
            message_id: message.message_id,
            chat_id: message.chat_id,
            chat_type: message.chat_type,
            message_type: message.message_type,
            content: message.content,
            mentions: message.mentions as Array<{ key: string; id: { open_id?: string; user_id?: string; union_id?: string }; name: string; tenant_key?: string }> | undefined,
          },
          sender: {
            sender_id: {
              open_id: senderId,
              user_id: sender.sender_id?.user_id,
              union_id: sender.sender_id?.union_id,
            },
            sender_type: sender.sender_type,
          },
        },
        client,
        logger,
      )

      if (!parsed.text && parsed.attachments.length === 0) {
        return {}
      }

      // Strip @bot mention
      const mentionsForStrip = message.mentions?.map((m: Record<string, unknown>) => ({
        key: m.key as string,
        id: (m.id ?? {}) as { open_id?: string; user_id?: string; union_id?: string },
        name: (m.name ?? '') as string,
      }))
      let text = stripBotMention(parsed.text, mentionsForStrip, deps.botOpenId)

      // Skip empty text after stripping mentions (unless attachments present)
      if (!text.trim() && parsed.attachments.length === 0) {
        return {}
      }

      // Identity resolution and access control live in the host
      // (plugin-host.ts::createDeliverFn) — single source of truth for the
      // trust-on-first-contact pairing policy.
      await deliver({
        sessionId: ['chat', accountId, message.chat_id, 'sender', senderId],
        sender: { id: senderId },
        deliveryContext: {
          to: `chat:${message.chat_id}`,
          accountId,
        },
        message: text,
        attachments: parsed.attachments.length > 0 ? parsed.attachments : undefined,
      })

      return {}
    },
  })
}
