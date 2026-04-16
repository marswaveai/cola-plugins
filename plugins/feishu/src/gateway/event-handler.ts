import type * as lark from '@larksuiteoapi/node-sdk'
import type { PluginLogger, DeliverFn, PluginRuntime } from 'cola-plugin-sdk'
import { parseMessage } from './message-parser.js'
import { stripBotMention } from '../util/mention.js'
import { MessageDedup } from './dedup.js'
import type { ChatMap } from './chat-map.js'

export type EventHandlerDeps = {
  client: lark.Client
  accountId: string
  logger: PluginLogger
  deliver: DeliverFn
  runtime: PluginRuntime
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
      const { logger, deliver, runtime, dedup, chatMap, client } = deps

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

      // Check identity binding
      const colaUserId = await runtime.identity.resolve(senderId)
      if (!colaUserId) {
        // Auto-bind for convenience (feishu users are authenticated by the platform)
        await runtime.identity.bind(senderId)
        logger.info(`Auto-bound feishu user ${senderId}`)
      }

      // Deliver to Cola
      // Note: metadata field requires SDK update — using type assertion for forward compatibility
      await deliver({
        channelUserId: senderId,
        message: text,
        attachments: parsed.attachments.length > 0 ? parsed.attachments : undefined,
        metadata: {
          messageId: message.message_id,
          chatId: message.chat_id,
          chatType: message.chat_type,
          timestamp: Date.now(),
        },
      } as Parameters<typeof deliver>[0])

      return {}
    },
  })
}
