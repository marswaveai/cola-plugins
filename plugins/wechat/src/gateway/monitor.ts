import fs from 'node:fs'
import path from 'node:path'

import type { PluginLogger, PluginRuntime, DeliverFn } from 'cola-plugin-sdk'
import { createPollLoop } from 'cola-plugin-sdk'
import { getUpdates } from '../api/client.js'
import { WeixinConfigManager } from '../api/config-cache.js'
import { SESSION_EXPIRED_ERRCODE, pauseSession, isSessionPaused } from '../api/session-guard.js'
import type { WeixinMessage, MessageItem } from '../api/types.js'
import { MessageType, MessageItemType } from '../api/types.js'
import { getPluginDir } from '../auth/accounts.js'
import type { ResolvedWeixinAccount } from '../auth/accounts.js'
import { downloadMediaFromItem } from '../media/media-download.js'
import { setContextToken, getContextToken, restoreContextTokens } from './context-tokens.js'

// Module-level config manager store — shared between monitor (writes) and outbound (reads)
const configManagers = new Map<string, WeixinConfigManager>()

export function registerConfigManager(accountId: string, manager: WeixinConfigManager): void {
  configManagers.set(accountId, manager)
}

export function getConfigManagerForAccount(accountId: string): WeixinConfigManager | undefined {
  return configManagers.get(accountId)
}

type MonitorOpts = {
  account: ResolvedWeixinAccount
  runtime: PluginRuntime
  deliver: DeliverFn
  logger: PluginLogger
  abortSignal: AbortSignal
}

function resolveSyncBufPath(accountId: string): string {
  return path.join(getPluginDir(), 'accounts', `${accountId}.sync.json`)
}

function loadSyncBuf(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as { get_updates_buf?: string }
    return typeof data.get_updates_buf === 'string' ? data.get_updates_buf : undefined
  } catch {
    return undefined
  }
}

function saveSyncBuf(filePath: string, buf: string): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify({ get_updates_buf: buf }), 'utf-8')
  } catch { /* best-effort */ }
}

function extractTextBody(msg: WeixinMessage): string {
  const items = msg.item_list ?? []
  const parts: string[] = []
  for (const item of items) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      parts.push(item.text_item.text)
    }
    // Voice-to-text fallback
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      parts.push(item.voice_item.text)
    }
  }
  // Also check quoted message text
  for (const item of items) {
    if (item.ref_msg?.title) {
      parts.push(`[引用: ${item.ref_msg.title}]`)
    }
  }
  return parts.join('\n')
}

function extractCause(err: Error): string | null {
  const cause = (err as { cause?: unknown }).cause
  if (!cause) return null
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code
    return code ? `${cause.message} code=${code}` : cause.message
  }
  if (typeof cause === 'object') {
    const obj = cause as { message?: unknown; code?: unknown; errno?: unknown }
    const parts: string[] = []
    if (typeof obj.message === 'string') parts.push(obj.message)
    if (typeof obj.code === 'string') parts.push(`code=${obj.code}`)
    if (typeof obj.errno === 'number' || typeof obj.errno === 'string') {
      parts.push(`errno=${obj.errno}`)
    }
    if (parts.length > 0) return parts.join(' ')
  }
  return String(cause)
}

function findFirstMediaItem(msg: WeixinMessage): MessageItem | undefined {
  const items = msg.item_list ?? []
  // Priority: image > video > file > voice
  for (const type of [MessageItemType.IMAGE, MessageItemType.VIDEO, MessageItemType.FILE, MessageItemType.VOICE]) {
    const found = items.find((i) => i.type === type)
    if (found) return found
  }
  // Check ref_msg for media
  for (const item of items) {
    const refItem = item.ref_msg?.message_item
    if (refItem && refItem.type && refItem.type !== MessageItemType.TEXT && refItem.type !== MessageItemType.NONE) {
      return refItem
    }
  }
  return undefined
}

export function startMonitor(opts: MonitorOpts): void {
  const { account, runtime, deliver, logger: log, abortSignal } = opts
  const syncBufPath = resolveSyncBufPath(account.accountId)

  // Restore context tokens from disk
  restoreContextTokens(account.accountId)

  let getUpdatesBuf = loadSyncBuf(syncBufPath) ?? ''
  let consecutiveFailures = 0

  const configManager = new WeixinConfigManager(
    { baseUrl: account.baseUrl, token: account.token },
    (msg) => log.info(msg),
  )
  registerConfigManager(account.accountId, configManager)

  createPollLoop<WeixinMessage>({
    signal: abortSignal,
    intervalMs: 0, // getUpdates is a long-poll, no extra interval needed

    async fetch(signal) {
      if (isSessionPaused(account.accountId)) {
        // Wait before retrying during session pause
        await new Promise((r) => setTimeout(r, 30_000))
        return []
      }

      const resp = await getUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        get_updates_buf: getUpdatesBuf,
      })

      // Handle session expiration
      if (resp.errcode === SESSION_EXPIRED_ERRCODE) {
        log.warn(`Session expired (errcode ${SESSION_EXPIRED_ERRCODE}), pausing for 1 hour`)
        pauseSession(account.accountId)
        return []
      }

      if (resp.ret !== 0 && resp.ret !== undefined) {
        throw new Error(`getUpdates error: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg}`)
      }

      // Update sync buf
      if (resp.get_updates_buf) {
        getUpdatesBuf = resp.get_updates_buf
        saveSyncBuf(syncBufPath, getUpdatesBuf)
      }

      consecutiveFailures = 0
      return resp.msgs ?? []
    },

    async onMessages(msgs) {
      for (const msg of msgs) {
        if (abortSignal.aborted) return
        try {
          await processMessage(msg, {
            account,
            runtime,
            deliver,
            log,
            configManager,
          })
        } catch (err) {
          log.error(`Error processing message: ${String(err)}`)
        }
      }
    },

    async onError(err) {
      consecutiveFailures++
      const causeMsg = extractCause(err)
      const suffix = causeMsg ? ` (cause: ${causeMsg})` : ''
      if (consecutiveFailures >= 3) {
        log.error(
          `${consecutiveFailures} consecutive failures, backing off: ${err.message}${suffix}`,
        )
      } else {
        log.warn(`Poll error (${consecutiveFailures}): ${err.message}${suffix}`)
      }
      // Exponential backoff with jitter, capped at 60s.
      const backoffMs = Math.min(1000 * 2 ** (consecutiveFailures - 1), 60_000)
      const jitter = Math.round(backoffMs * (0.75 + Math.random() * 0.5))
      await new Promise((r) => setTimeout(r, jitter))
    },
  })

  log.info(`Monitor started for account ${account.accountId}`)
}

async function processMessage(
  msg: WeixinMessage,
  deps: {
    account: ResolvedWeixinAccount
    runtime: PluginRuntime
    deliver: DeliverFn
    log: PluginLogger
    configManager: WeixinConfigManager
  },
): Promise<void> {
  const { account, runtime, deliver, log } = deps

  // Only process user messages
  if (msg.message_type !== MessageType.USER) return

  const fromUserId = msg.from_user_id
  if (!fromUserId) return

  // Identity resolution and access control live in the host (trust-on-first-contact pairing)

  // Persist context token
  if (msg.context_token) {
    setContextToken(account.accountId, fromUserId, msg.context_token)
  }

  // Extract text body
  const textBody = extractTextBody(msg)

  // Download media if present
  const mediaItem = findFirstMediaItem(msg)
  const attachments: string[] = []
  if (mediaItem) {
    const result = await downloadMediaFromItem(mediaItem, {
      cdnBaseUrl: account.cdnBaseUrl,
      runtime,
      log,
    })
    if (result.filePath) {
      attachments.push(result.filePath)
    }
  }

  // Deliver to Cola agent
  const message = textBody || (attachments.length > 0 ? '[media]' : '')
  if (!message && attachments.length === 0) return

  await deliver({
    channelUserId: fromUserId,
    message,
    attachments: attachments.length > 0 ? attachments : undefined,
    senderId: fromUserId,
  })
}
