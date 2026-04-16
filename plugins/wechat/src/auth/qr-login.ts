import { randomUUID } from 'node:crypto'

import type { PluginLogger, PluginRuntime } from 'cola-plugin-sdk'
import { apiGetFetch } from '../api/client.js'
import { redactToken } from '../util/redact.js'
import {
  saveAccount,
  registerAccountId,
  clearStaleAccountsForUserId,
} from './accounts.js'
import { clearContextTokensForAccount } from '../gateway/context-tokens.js'

type ActiveLogin = {
  sessionKey: string
  id: string
  qrcode: string
  qrcodeUrl: string
  startedAt: number
  botToken?: string
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect'
  currentApiBaseUrl?: string
}

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000
const QR_LONG_POLL_TIMEOUT_MS = 35_000
const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com'
const DEFAULT_ILINK_BOT_TYPE = '3'
const MAX_QR_REFRESH_COUNT = 3

const activeLogins = new Map<string, ActiveLogin>()

export type QRCodeResponse = {
  qrcode: string
  qrcode_img_content: string
}

type StatusResponse = {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect'
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
  redirect_host?: string
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS
}

function purgeExpiredLogins(): void {
  for (const [id, login] of activeLogins) {
    if (!isLoginFresh(login)) activeLogins.delete(id)
  }
}

export { FIXED_BASE_URL, DEFAULT_ILINK_BOT_TYPE }

export async function fetchQRCode(apiBaseUrl: string, botType: string): Promise<QRCodeResponse> {
  const rawText = await apiGetFetch({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    label: 'fetchQRCode',
  })
  return JSON.parse(rawText) as QRCodeResponse
}

async function pollQRStatus(apiBaseUrl: string, qrcode: string, log: PluginLogger): Promise<StatusResponse> {
  try {
    const rawText = await apiGetFetch({
      baseUrl: apiBaseUrl,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: 'pollQRStatus',
    })
    return JSON.parse(rawText) as StatusResponse
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'wait' }
    }
    log.warn(`pollQRStatus: network/gateway error, will retry: ${String(err)}`)
    return { status: 'wait' }
  }
}

export type QrLoginResult = {
  connected: boolean
  botToken?: string
  accountId?: string
  baseUrl?: string
  userId?: string
  message: string
}

/**
 * Full QR login flow:
 * 1. Fetch QR code from WeChat API
 * 2. Display via onQrCode callback (or qrcode-terminal as fallback)
 * 3. Poll for scan status until confirmed, expired, or timeout
 * 4. On success: save credentials, bind identity, clean stale accounts
 */
export async function performQrLogin(opts: {
  runtime: PluginRuntime
  logger: PluginLogger
  pluginConfig: Readonly<Record<string, unknown>>
  onQrCode?: (dataUrl: string) => void
  onStatus?: (status: string, message?: string) => void
}): Promise<QrLoginResult> {
  const { runtime, logger: log, onQrCode, onStatus } = opts
  const sessionKey = randomUUID()
  purgeExpiredLogins()

  // Step 1: Fetch QR code
  let qrResponse: QRCodeResponse
  try {
    log.info('Starting WeChat QR login')
    qrResponse = await fetchQRCode(FIXED_BASE_URL, DEFAULT_ILINK_BOT_TYPE)
    log.info(`QR code received, qrcode=${redactToken(qrResponse.qrcode)}`)
  } catch (err) {
    log.error(`Failed to fetch QR code: ${String(err)}`)
    return { connected: false, message: `Failed to start login: ${String(err)}` }
  }

  // Step 2: Display QR code
  if (onQrCode) {
    onQrCode(qrResponse.qrcode_img_content)
  } else {
    // CLI fallback: render in terminal
    try {
      const qrterm = await import('qrcode-terminal')
      qrterm.default.generate(qrResponse.qrcode_img_content, { small: true })
    } catch {
      log.info(`QR URL: ${qrResponse.qrcode_img_content}`)
    }
  }
  onStatus?.('waiting', '请使用微信扫描二维码')

  const login: ActiveLogin = {
    sessionKey,
    id: randomUUID(),
    qrcode: qrResponse.qrcode,
    qrcodeUrl: qrResponse.qrcode_img_content,
    startedAt: Date.now(),
    currentApiBaseUrl: FIXED_BASE_URL,
  }
  activeLogins.set(sessionKey, login)

  // Step 3: Poll for status
  const deadline = Date.now() + 480_000
  let scannedNotified = false
  let qrRefreshCount = 1

  while (Date.now() < deadline) {
    const currentBaseUrl = login.currentApiBaseUrl ?? FIXED_BASE_URL
    const statusResponse = await pollQRStatus(currentBaseUrl, login.qrcode, log)
    login.status = statusResponse.status

    switch (statusResponse.status) {
      case 'wait':
        break

      case 'scaned':
        if (!scannedNotified) {
          onStatus?.('scanned', '已扫码，请在微信上确认')
          scannedNotified = true
        }
        break

      case 'expired': {
        qrRefreshCount++
        if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
          activeLogins.delete(sessionKey)
          return { connected: false, message: '登录超时：二维码多次过期，请重新开始登录流程。' }
        }
        onStatus?.('refreshing', `二维码已过期，正在刷新...(${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})`)
        try {
          const newQr = await fetchQRCode(FIXED_BASE_URL, DEFAULT_ILINK_BOT_TYPE)
          login.qrcode = newQr.qrcode
          login.qrcodeUrl = newQr.qrcode_img_content
          login.startedAt = Date.now()
          scannedNotified = false
          if (onQrCode) {
            onQrCode(newQr.qrcode_img_content)
          } else {
            try {
              const qrterm = await import('qrcode-terminal')
              qrterm.default.generate(newQr.qrcode_img_content, { small: true })
            } catch { /* ignore */ }
          }
        } catch (refreshErr) {
          activeLogins.delete(sessionKey)
          return { connected: false, message: `刷新二维码失败: ${String(refreshErr)}` }
        }
        break
      }

      case 'scaned_but_redirect': {
        const redirectHost = statusResponse.redirect_host
        if (redirectHost) {
          login.currentApiBaseUrl = `https://${redirectHost}`
          log.info(`IDC redirect, switching polling host to ${redirectHost}`)
        }
        break
      }

      case 'confirmed': {
        activeLogins.delete(sessionKey)
        if (!statusResponse.ilink_bot_id) {
          return { connected: false, message: '登录失败：服务器未返回 ilink_bot_id。' }
        }

        const accountId = statusResponse.ilink_bot_id
        const userId = statusResponse.ilink_user_id

        // Save credentials
        registerAccountId(accountId)
        saveAccount(accountId, {
          token: statusResponse.bot_token,
          baseUrl: statusResponse.baseurl,
          userId,
        })

        // Clean stale accounts sharing same userId
        clearStaleAccountsForUserId(accountId, userId ?? '', log, clearContextTokensForAccount)

        // Bind identity to primary Cola user
        if (userId) {
          await runtime.identity.bind(userId)
          log.info(`Identity bound: ${redactToken(userId)}`)
        }

        onStatus?.('connected', '与微信连接成功')
        return {
          connected: true,
          botToken: statusResponse.bot_token,
          accountId,
          baseUrl: statusResponse.baseurl,
          userId,
          message: '与微信连接成功！',
        }
      }
    }

    await new Promise((r) => setTimeout(r, 1000))
  }

  activeLogins.delete(sessionKey)
  return { connected: false, message: '登录超时，请重试。' }
}

/**
 * Background QR login poll — runs after QR code has been returned to the user.
 * Fire-and-forget: saves credentials, binds identity, reloads gateway on success.
 */
export async function pollQrLoginBackground(opts: {
  qrcode: string
  runtime: PluginRuntime
  logger: PluginLogger
}): Promise<void> {
  const { qrcode, runtime, logger: log } = opts

  const deadline = Date.now() + 480_000
  let currentApiBaseUrl = FIXED_BASE_URL

  while (Date.now() < deadline) {
    const statusResponse = await pollQRStatus(currentApiBaseUrl, qrcode, log)

    switch (statusResponse.status) {
      case 'wait':
      case 'scaned':
        break

      case 'expired':
        log.warn('QR code expired during background poll')
        return

      case 'scaned_but_redirect': {
        const redirectHost = statusResponse.redirect_host
        if (redirectHost) {
          currentApiBaseUrl = `https://${redirectHost}`
          log.info(`IDC redirect, switching polling host to ${redirectHost}`)
        }
        break
      }

      case 'confirmed': {
        if (!statusResponse.ilink_bot_id) {
          log.error('Login confirmed but no ilink_bot_id returned')
          return
        }

        const accountId = statusResponse.ilink_bot_id
        const userId = statusResponse.ilink_user_id

        registerAccountId(accountId)
        saveAccount(accountId, {
          token: statusResponse.bot_token,
          baseUrl: statusResponse.baseurl,
          userId,
        })

        clearStaleAccountsForUserId(accountId, userId ?? '', log, clearContextTokensForAccount)

        if (userId) {
          await runtime.identity.bind(userId)
          log.info(`Identity bound: ${redactToken(userId)}`)
        }

        log.info(`Background login completed: accountId=${accountId}`)
        await runtime.reloadGateway?.()
        return
      }
    }

    await new Promise((r) => setTimeout(r, 1000))
  }

  log.warn('Background login poll timed out')
}
