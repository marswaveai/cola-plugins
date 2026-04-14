import crypto from 'node:crypto'

import type { PluginLogger } from '@cola/plugin-sdk'
import { redactBody, redactUrl } from '../util/redact.js'
import type {
  BaseInfo,
  GetUploadUrlReq,
  GetUploadUrlResp,
  GetUpdatesReq,
  GetUpdatesResp,
  SendMessageReq,
  SendTypingReq,
  GetConfigResp,
} from './types.js'

export type WeixinApiOptions = {
  baseUrl: string
  token?: string
  timeoutMs?: number
  longPollTimeoutMs?: number
}

// ---------------------------------------------------------------------------
// BaseInfo
// ---------------------------------------------------------------------------

const CHANNEL_VERSION = '0.1.0'
const ILINK_APP_ID = 'bot'
const ILINK_APP_CLIENT_VERSION = buildClientVersion(CHANNEL_VERSION)

function buildClientVersion(version: string): number {
  const parts = version.split('.').map((p) => parseInt(p, 10))
  const major = parts[0] ?? 0
  const minor = parts[1] ?? 0
  const patch = parts[2] ?? 0
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

export function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION }
}

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
const DEFAULT_API_TIMEOUT_MS = 15_000
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

let routeTag: string | undefined

export function setRouteTag(tag: string | undefined): void {
  routeTag = tag
}

function buildCommonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  }
  if (routeTag) {
    headers.SKRouteTag = routeTag
  }
  return headers
}

function buildHeaders(opts: { token?: string; body: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(opts.body, 'utf-8')),
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders(),
  }
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`
  }
  return headers
}

// Module-level logger, set during plugin init
let log: PluginLogger = { info() {}, warn() {}, error() {} }

export function setApiLogger(logger: PluginLogger): void {
  log = logger
}

export async function apiGetFetch(params: {
  baseUrl: string
  endpoint: string
  timeoutMs?: number
  label: string
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl)
  const url = new URL(params.endpoint, base)
  const hdrs = buildCommonHeaders()
  log.info(`GET ${redactUrl(url.toString())}`)

  const timeoutMs = params.timeoutMs
  const controller = timeoutMs != null && timeoutMs > 0 ? new AbortController() : undefined
  const t = controller != null && timeoutMs != null ? setTimeout(() => controller.abort(), timeoutMs) : undefined
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: hdrs,
      ...(controller ? { signal: controller.signal } : {}),
    })
    if (t !== undefined) clearTimeout(t)
    const rawText = await res.text()
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`)
    }
    return rawText
  } catch (err) {
    if (t !== undefined) clearTimeout(t)
    throw err
  }
}

async function apiPostFetch(params: {
  baseUrl: string
  endpoint: string
  body: string
  token?: string
  timeoutMs: number
  label: string
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl)
  const url = new URL(params.endpoint, base)
  const hdrs = buildHeaders({ token: params.token, body: params.body })

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: hdrs,
      body: params.body,
      signal: controller.signal,
    })
    clearTimeout(t)
    const rawText = await res.text()
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`)
    }
    return rawText
  } catch (err) {
    clearTimeout(t)
    throw err
  }
}

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------

export async function getUpdates(
  params: GetUpdatesReq & { baseUrl: string; token?: string; timeoutMs?: number },
): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS
  try {
    const rawText = await apiPostFetch({
      baseUrl: params.baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: JSON.stringify({
        get_updates_buf: params.get_updates_buf ?? '',
        base_info: buildBaseInfo(),
      }),
      token: params.token,
      timeoutMs: timeout,
      label: 'getUpdates',
    })
    return JSON.parse(rawText) as GetUpdatesResp
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf }
    }
    throw err
  }
}

export async function getUploadUrl(
  params: GetUploadUrlReq & WeixinApiOptions,
): Promise<GetUploadUrlResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/getuploadurl',
    body: JSON.stringify({
      filekey: params.filekey,
      media_type: params.media_type,
      to_user_id: params.to_user_id,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      thumb_rawsize: params.thumb_rawsize,
      thumb_rawfilemd5: params.thumb_rawfilemd5,
      thumb_filesize: params.thumb_filesize,
      no_need_thumb: params.no_need_thumb,
      aeskey: params.aeskey,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: 'getUploadUrl',
  })
  return JSON.parse(rawText) as GetUploadUrlResp
}

export async function sendMessage(
  params: WeixinApiOptions & { body: SendMessageReq },
): Promise<void> {
  await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: 'sendMessage',
  })
}

export async function getConfig(
  params: WeixinApiOptions & { ilinkUserId: string; contextToken?: string },
): Promise<GetConfigResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/getconfig',
    body: JSON.stringify({
      ilink_user_id: params.ilinkUserId,
      context_token: params.contextToken,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: 'getConfig',
  })
  return JSON.parse(rawText) as GetConfigResp
}

export async function sendTyping(
  params: WeixinApiOptions & { body: SendTypingReq },
): Promise<void> {
  await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/sendtyping',
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: 'sendTyping',
  })
}
