import { defineChannel } from 'cola-plugin-sdk'
import type {
  GatewayContext,
  OutboundContext,
  ChannelStatusResult,
  ChannelMessageActionAdapter,
} from 'cola-plugin-sdk'
import type { FeishuPluginConfig } from './api/types.js'
import { setPluginDir, resolvePluginDir, parseAccountConfigs } from './auth/accounts.js'
import { feishuSetupWizard } from './auth/setup.js'
import { startMonitor, type MonitorHandle } from './gateway/monitor.js'
import { sendText, sendMedia } from './outbound/send.js'
import { createFeishuCommands } from './commands/feishu.js'
import { clearClientCache } from './api/client.js'

type FeishuGatewayState = {
  monitors: Map<string, MonitorHandle>
}

// Module-level monitor registry — populated by gateway.start, read by outbound/tools
let activeMonitors = new Map<string, MonitorHandle>()

function resolveMonitorForUser(channelUserId: string): MonitorHandle | undefined {
  // Check which account's chatMap knows this user
  for (const handle of activeMonitors.values()) {
    if (handle.chatMap.hasUser(channelUserId)) return handle
  }
  // Fallback: return first available monitor (single-account scenario)
  const first = activeMonitors.values().next()
  return first.done ? undefined : first.value
}

export default defineChannel<FeishuGatewayState>({
  id: 'feishu',

  meta: {
    label: 'Feishu',
    description: 'Feishu/Lark messaging via official bot API',
    markdownCapable: true,
  },

  setup: feishuSetupWizard,

  capabilities: {
    receive: {
      text: true,
      image: true,
      file: true,
      reaction: true,
    },
    send: {
      text: true,
      image: true,
      file: true,
      markdown: true,
    },
    limits: {
      maxTextLength: 30000,
    },
  },

  sessionMode: 'shared',

  commands: createFeishuCommands(() => activeMonitors),

  gateway: {
    async start(ctx: GatewayContext<FeishuGatewayState>) {
      const config = ctx.config as unknown as FeishuPluginConfig
      const dir = resolvePluginDir(config)
      setPluginDir(dir)

      const monitors = new Map<string, MonitorHandle>()
      ctx.state.monitors = monitors

      const accounts = parseAccountConfigs(config)
      if (accounts.size === 0) {
        ctx.logger.warn('No Feishu accounts configured')
        return
      }

      for (const [accountId, acctConfig] of accounts) {
        try {
          const handle = startMonitor({
            accountId,
            config: acctConfig,
            deliver: ctx.deliver,
            runtime: ctx.runtime,
            logger: ctx.logger,
            abortSignal: ctx.abortSignal,
          })
          monitors.set(accountId, handle)
        } catch (err) {
          ctx.logger.error(`Failed to start monitor for account ${accountId}`, err)
        }
      }

      // Update module-level reference
      activeMonitors = monitors

      ctx.logger.info(`Feishu gateway started with ${monitors.size} account(s)`)
    },

    async stop(ctx: GatewayContext<FeishuGatewayState>) {
      const monitors = ctx.state.monitors
      if (!monitors) return

      for (const [id, handle] of monitors) {
        ctx.logger.info(`Stopping feishu account ${id}`)
        handle.cleanup()
      }
      monitors.clear()
      activeMonitors = new Map()
      clearClientCache()
    },

    async reload(ctx: GatewayContext<FeishuGatewayState>) {
      await this.stop!(ctx)
      await this.start(ctx)
    },

    getStatus(ctx: GatewayContext<FeishuGatewayState>): ChannelStatusResult {
      const monitors = ctx.state.monitors
      if (!monitors || monitors.size === 0) {
        return { connected: false, configured: false, message: 'No accounts configured' }
      }
      return {
        connected: true,
        configured: true,
        message: `${monitors.size} account(s) connected`,
      }
    },
  },

  outbound: {
    async sendText(ctx: OutboundContext) {
      const handle = resolveMonitorForUser(ctx.channelUserId)
      if (!handle) {
        ctx.logger.error('sendText: no active Feishu account')
        return
      }
      await sendText(handle.client, ctx.channelUserId, ctx.text, handle.chatMap, ctx.logger)
    },

    async sendMedia(ctx: OutboundContext & { mediaType: string; filePath: string }) {
      const handle = resolveMonitorForUser(ctx.channelUserId)
      if (!handle) {
        ctx.logger.error('sendMedia: no active Feishu account')
        return
      }
      await sendMedia(handle.client, ctx.channelUserId, ctx.mediaType, ctx.filePath, handle.chatMap, ctx.logger)
    },
  },

  messaging: {
    describeMessageTool: () => ({
      actions: ['send', 'react'],
      schema: {
        properties: {
          emoji: {
            type: 'string',
            description:
              'Feishu emoji_type for the react action. Examples: THUMBSUP, SMILE, HEART, OK, FACEPALM, JIAYI, COFFEE, FIREWORKS, MUSCLE.',
          },
        },
        visibility: 'current-channel',
      },
    }),

    async handleAction(ctx) {
      const handle = resolveMonitorForUser(ctx.channelUserId)
      if (!handle) {
        return { ok: false, hint: 'No active Feishu account for this user.' }
      }

      if (ctx.action === 'send') {
        const text = typeof ctx.params.text === 'string' ? ctx.params.text : ''
        const media = typeof ctx.params.media === 'string' ? ctx.params.media : ''
        const caption = typeof ctx.params.caption === 'string' ? ctx.params.caption : ''
        if (!text && !media) {
          return { ok: false, hint: 'send requires at least one of `text` or `media`.' }
        }
        try {
          if (media) {
            const mediaType =
              typeof ctx.params.mediaType === 'string' ? ctx.params.mediaType : 'application/octet-stream'
            await sendMedia(handle.client, ctx.channelUserId, mediaType, media, handle.chatMap, ctx.logger)
            if (caption) {
              await sendText(handle.client, ctx.channelUserId, caption, handle.chatMap, ctx.logger)
            }
            return { ok: true, message: 'Sent media to Feishu.' }
          }
          await sendText(handle.client, ctx.channelUserId, text, handle.chatMap, ctx.logger)
          return { ok: true, message: 'Sent text to Feishu.' }
        } catch (err) {
          return { ok: false, hint: `Feishu send failed: ${String(err)}` }
        }
      }

      if (ctx.action === 'react') {
        const emoji = typeof ctx.params.emoji === 'string' ? ctx.params.emoji : ''
        if (!emoji) {
          return { ok: false, hint: 'react requires `emoji` (Feishu emoji_type, e.g. THUMBSUP).' }
        }
        const messageId =
          (typeof ctx.params.messageId === 'string' ? ctx.params.messageId : undefined) ??
          (typeof ctx.toolContext.currentMessageId === 'string'
            ? ctx.toolContext.currentMessageId
            : undefined)
        if (!messageId) {
          return { ok: false, hint: 'react needs a messageId (from toolContext or params).' }
        }
        try {
          const resp = await handle.client.im.messageReaction.create({
            path: { message_id: messageId },
            data: { reaction_type: { emoji_type: emoji } },
          })
          return {
            ok: true,
            message: 'Reacted to Feishu message.',
            details: { reactionId: (resp as { reaction_id?: string })?.reaction_id },
          }
        } catch (err) {
          return { ok: false, hint: `Feishu react failed: ${String(err)}` }
        }
      }

      return { ok: false, hint: `Feishu plugin does not support action "${ctx.action}"` }
    },
  } satisfies ChannelMessageActionAdapter,
})
