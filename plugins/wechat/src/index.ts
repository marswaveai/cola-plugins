import path from 'node:path'
import os from 'node:os'

import { defineChannel } from 'cola-plugin-sdk'
import type {
  GatewayContext,
  OutboundContext,
  DeliveryContext,
  ChannelStatusResult,
} from 'cola-plugin-sdk'
import { setApiLogger, setRouteTag, sendTyping as sendTypingApi } from './api/client.js'
import { setSessionGuardLogger } from './api/session-guard.js'
import { TypingStatus } from './api/types.js'
import {
  setPluginDir,
  listAccountIds,
  loadAccount,
  clearAccount,
  unregisterAccountId,
  resolveAccount,
  resolveDefaultAccount,
} from './auth/accounts.js'
import type { ResolvedWeixinAccount } from './auth/accounts.js'
import { performQrLogin } from './auth/qr-login.js'
import { clearContextTokensForAccount, getContextToken } from './gateway/context-tokens.js'
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

function resolveWechatRecipient(deliveryContext: DeliveryContext): string {
  const { to } = deliveryContext
  return to.startsWith('user:') ? to.slice('user:'.length) : to
}

function resolveAccountForDelivery(
  config: Readonly<Record<string, unknown>>,
  deliveryContext: DeliveryContext,
): ResolvedWeixinAccount | undefined {
  if (deliveryContext.accountId) {
    const account = resolveAccount(deliveryContext.accountId, config)
    if (account.enabled && account.configured) return account
  }
  return resolveDefaultAccount(config) ?? undefined
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
      const account = resolveAccountForDelivery(config, ctx.deliveryContext)
      if (!account) {
        ctx.logger.error('sendText: no configured WeChat account')
        return
      }

      const recipient = resolveWechatRecipient(ctx.deliveryContext)
      const contextToken = getContextToken(account.accountId, recipient)
      await sendMessageWeixin({
        to: recipient,
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
      const account = resolveAccountForDelivery(config, ctx.deliveryContext)
      if (!account) {
        ctx.logger.error('sendMedia: no configured WeChat account')
        return
      }

      const recipient = resolveWechatRecipient(ctx.deliveryContext)
      const contextToken = getContextToken(account.accountId, recipient)
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
        to: recipient,
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
      const account = resolveAccountForDelivery(ctx.config, ctx.deliveryContext)
      if (!account) return

      const configManager = getConfigManagerForAccount(account.accountId)
      if (!configManager) return

      const recipient = resolveWechatRecipient(ctx.deliveryContext)
      const contextToken = getContextToken(account.accountId, recipient)
      const cached = await configManager.getForUser(recipient, contextToken)
      if (!cached.typingTicket) return

      await sendTypingApi({
        baseUrl: account.baseUrl,
        token: account.token,
        body: {
          ilink_user_id: recipient,
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

    async disconnect(ctx) {
      setPluginDir(
        (ctx.config.pluginDir as string) || path.join(os.homedir(), '.cola', 'channels', 'wechat'),
      )

      for (const accountId of listAccountIds()) {
        const account = loadAccount(accountId)
        if (account?.userId) {
          await ctx.runtime.identity.unbind(account.userId)
        }
        clearContextTokensForAccount(accountId)
        clearAccount(accountId)
        unregisterAccountId(accountId)
      }

      ctx.onStatus?.('disconnected', 'WeChat disconnected')
      ctx.logger.info('WeChat disconnected')
    },
  },
})
