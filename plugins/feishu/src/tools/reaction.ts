import type { ChannelAgentTool } from 'cola-plugin-sdk'
import type { MonitorHandle } from '../gateway/monitor.js'

/**
 * Create feishu_react tool that allows the agent to add emoji reactions to messages.
 */
export function createReactionTools(
  monitors: Map<string, MonitorHandle>,
): ChannelAgentTool[] {
  // No active accounts — no tools
  if (monitors.size === 0) return []

  return [{
    name: 'feishu_react',
    description: 'Add an emoji reaction to a Feishu message. Use this when a user sends a message and you want to acknowledge it with an emoji before or instead of a text reply.',
    parameters: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'The message ID to react to. This is provided in the [msgId:xxx] prefix of incoming messages.',
        },
        emoji_type: {
          type: 'string',
          description: 'The emoji type to react with. Examples: THUMBSUP, SMILE, HEART, OK, JIAYI (加一/+1), FACEPALM, COFFEE, BEER, FIREWORKS, MUSCLE',
        },
      },
      required: ['message_id', 'emoji_type'],
    },
    async execute(input: unknown) {
      const { message_id, emoji_type } = input as { message_id: string; emoji_type: string }

      // Find any available client (reactions don't need user-specific routing)
      const handle = monitors.values().next().value
      if (!handle) {
        throw new Error('No active Feishu account')
      }

      const resp = await handle.client.im.messageReaction.create({
        path: { message_id },
        data: { reaction_type: { emoji_type } },
      })

      return { ok: true, reaction_id: (resp as Record<string, unknown>)?.reaction_id }
    },
  }]
}
