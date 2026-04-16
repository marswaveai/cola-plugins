import { defineChannel } from 'cola-plugin-sdk'
import type { GatewayContext, OutboundContext, ChannelStatusResult } from 'cola-plugin-sdk'
import type { FeishuPluginConfig } from './api/types.js'
import { setPluginDir, resolvePluginDir, parseAccountConfigs } from './auth/accounts.js'
import { startMonitor, type MonitorHandle } from './gateway/monitor.js'
import { sendText, sendMedia } from './outbound/send.js'
import { createFeishuCommands } from './commands/feishu.js'
import { createReactionTools } from './tools/reaction.js'
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
      // reaction: true, // TODO: requires SDK update (send.reaction not in published SDK yet)
    },
    limits: {
      maxTextLength: 30000,
    },
  },

  sessionMode: 'shared',

  commands: createFeishuCommands(
    () => activeMonitors,
    () => ({}),
  ),

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

  agentTools: {
    getTools(_ctx) {
      return createReactionTools(activeMonitors)
    },
  },
})
