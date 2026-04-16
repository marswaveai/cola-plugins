import path from 'node:path'
import os from 'node:os'

import { defineChannel } from 'cola-plugin-sdk'
import type { GatewayContext, OutboundContext, ChannelStatusResult } from 'cola-plugin-sdk'
import { setApiLogger, setRouteTag, sendTyping as sendTypingApi } from './api/client.js'
import { setSessionGuardLogger } from './api/session-guard.js'
import { TypingStatus } from './api/types.js'
import {
  setPluginDir,
  listAccountIds,
  resolveAccount,
  resolveDefaultAccount,
} from './auth/accounts.js'
import type { ResolvedWeixinAccount } from './auth/accounts.js'
import { performQrLogin } from './auth/qr-login.js'
import { getContextToken } from './gateway/context-tokens.js'
import { startMonitor, getConfigManagerForAccount } from './gateway/monitor.js'
import { StreamingMarkdownFilter } from './outbound/markdown-filter.js'
import { sendMessageWeixin } from './outbound/send.js'
import { sendWeixinMediaFile } from './outbound/send-media.js'
import { downloadRemoteImageToTemp } from './cdn/upload.js'
import { handleWechat } from './commands/wechat.js'

const MEDIA_OUTBOUND_TEMP_DIR = path.join(os.tmpdir(), 'cola-wechat-media', 'outbound-temp')

type WechatGatewayState = {
  monitoredAccounts: Set<string>
}

function isLocalFilePath(mediaUrl: string): boolean {
  return !mediaUrl.includes('://')
}

function resolveLocalPath(mediaUrl: string): string {
  if (mediaUrl.startsWith('file://')) return new URL(mediaUrl).pathname
  if (!path.isAbsolute(mediaUrl)) return path.resolve(mediaUrl)
  return mediaUrl
}

export default defineChannel<WechatGatewayState>({
  id: 'wechat',
  sessionMode: 'shared',

  commands: [
    {
      name: 'wechat',
      aliases: ['wx'],
      description: '查看 WeChat 状态或扫码登录',
      args: [{ name: 'subcommand', description: 'login | status', required: false }],
      execute: handleWechat,
    },
  ],

  meta: {
    label: 'WeChat',
    description: 'WeChat messaging channel via iLink bot protocol',
    markdownCapable: false,
  },

  capabilities: {
    receive: {
      text: true,
      image: true,
      voice: true,
      file: true,
      video: true,
    },
    send: {
      text: true,
      image: true,
      file: true,
      video: true,
      typing: true,
    },
    limits: {
      maxTextLength: 4000,
    },
  },

  gateway: {
    async start(ctx: GatewayContext<WechatGatewayState>) {
      const log = ctx.logger
      ctx.state.monitoredAccounts = new Set()

      // Initialize plugin-wide singletons
      setPluginDir(
        (ctx.config.pluginDir as string) || path.join(os.homedir(), '.cola', 'channels', 'wechat'),
      )
      setApiLogger(log)
      setSessionGuardLogger(log)

      const routeTag = ctx.config.routeTag as string | undefined
      if (routeTag) setRouteTag(routeTag)

      // Start a monitor for each configured and enabled account
      const accountIds = listAccountIds()
      if (accountIds.length === 0) {
        log.info('No WeChat accounts configured. Run auth login to add one.')
        return
      }

      for (const accountId of accountIds) {
        const account = resolveAccount(accountId, ctx.config)
        if (!account.enabled || !account.configured) {
          log.info(`Skipping account ${accountId} (enabled=${account.enabled}, configured=${account.configured})`)
          continue
        }

        startMonitor({
          account,
          runtime: ctx.runtime,
          deliver: ctx.deliver,
          logger: log,
          abortSignal: ctx.abortSignal,
        })
        ctx.state.monitoredAccounts.add(accountId)
      }
    },

    async reload(ctx: GatewayContext<WechatGatewayState>) {
      const log = ctx.logger
      const accountIds = listAccountIds()

      for (const accountId of accountIds) {
        if (ctx.state.monitoredAccounts.has(accountId)) continue

        const account = resolveAccount(accountId, ctx.config)
        if (!account.enabled || !account.configured) continue

        startMonitor({
          account,
          runtime: ctx.runtime,
          deliver: ctx.deliver,
          logger: log,
          abortSignal: ctx.abortSignal,
        })
        ctx.state.monitoredAccounts.add(accountId)
        log.info(`Hot-loaded new account: ${accountId}`)
      }
    },

    async stop(ctx: GatewayContext<WechatGatewayState>) {
      ctx.logger.info('WeChat gateway stopping')
      // AbortSignal handles cleanup in startMonitor
    },

    getStatus(ctx: GatewayContext<WechatGatewayState>): ChannelStatusResult {
      const account = resolveDefaultAccount(ctx.config)
      if (!account) {
        return { connected: false, configured: false, message: 'No WeChat account configured' }
      }
      const monitored = ctx.state.monitoredAccounts?.has(account.accountId) ?? false
      return {
        connected: monitored,
        configured: true,
        message: monitored ? `Monitoring account ${account.accountId}` : 'Account configured but not monitored',
      }
    },
  },

  outbound: {
    textChunkLimit: 4000,

    sanitizeText(text: string): string {
      const f = new StreamingMarkdownFilter()
      return f.feed(text) + f.flush()
    },

    async sendText(ctx: OutboundContext) {
      const config = ctx.config
      const account = resolveDefaultAccount(config)
      if (!account) {
        ctx.logger.error('sendText: no configured WeChat account')
        return
      }

      const contextToken = getContextToken(account.accountId, ctx.channelUserId)
      await sendMessageWeixin({
        to: ctx.channelUserId,
        text: ctx.text,
        opts: {
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken,
        },
        log: ctx.logger,
      })
    },

    async sendMedia(ctx: OutboundContext & { mediaType: string; filePath: string }) {
      const config = ctx.config
      const account = resolveDefaultAccount(config)
      if (!account) {
        ctx.logger.error('sendMedia: no configured WeChat account')
        return
      }

      const contextToken = getContextToken(account.accountId, ctx.channelUserId)
      let localPath: string

      if (isLocalFilePath(ctx.filePath)) {
        localPath = resolveLocalPath(ctx.filePath)
      } else if (ctx.filePath.startsWith('http://') || ctx.filePath.startsWith('https://')) {
        localPath = await downloadRemoteImageToTemp(ctx.filePath, MEDIA_OUTBOUND_TEMP_DIR, ctx.logger)
      } else {
        ctx.logger.warn(`sendMedia: unsupported media URL scheme: ${ctx.filePath}`)
        return
      }

      await sendWeixinMediaFile({
        filePath: localPath,
        to: ctx.channelUserId,
        text: '',
        opts: {
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken,
        },
        cdnBaseUrl: account.cdnBaseUrl,
        log: ctx.logger,
      })
    },

    async sendTyping(ctx: OutboundContext & { active: boolean }) {
      const account = resolveDefaultAccount(ctx.config)
      if (!account) return

      const configManager = getConfigManagerForAccount(account.accountId)
      if (!configManager) return

      const contextToken = getContextToken(account.accountId, ctx.channelUserId)
      const cached = await configManager.getForUser(ctx.channelUserId, contextToken)
      if (!cached.typingTicket) return

      await sendTypingApi({
        baseUrl: account.baseUrl,
        token: account.token,
        body: {
          ilink_user_id: ctx.channelUserId,
          typing_ticket: cached.typingTicket,
          status: ctx.active ? TypingStatus.TYPING : TypingStatus.CANCEL,
        },
      })
    },
  },

  auth: {
    async login(ctx) {
      setPluginDir(
        (ctx.config.pluginDir as string) || path.join(os.homedir(), '.cola', 'channels', 'wechat'),
      )
      setApiLogger(ctx.logger)

      const result = await performQrLogin({
        runtime: ctx.runtime,
        logger: ctx.logger,
        pluginConfig: ctx.config,
        onQrCode: ctx.onQrCode,
        onStatus: ctx.onStatus,
      })

      if (result.connected) {
        ctx.logger.info(`WeChat login successful: accountId=${result.accountId}`)
      } else {
        ctx.logger.error(`WeChat login failed: ${result.message}`)
      }
    },
  },
})
