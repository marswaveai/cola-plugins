import fs from 'node:fs'
import path from 'node:path'

import type { PluginLogger } from '@marswave/cola-plugin-sdk'

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

// ---------------------------------------------------------------------------
// State directory — all plugin data lives under pluginDir
// ---------------------------------------------------------------------------

let pluginDir = ''

export function setPluginDir(dir: string): void {
  pluginDir = dir
}

export function getPluginDir(): string {
  return pluginDir
}

function resolveAccountsDir(): string {
  return path.join(pluginDir, 'accounts')
}

function resolveAccountIndexPath(): string {
  return path.join(pluginDir, 'accounts.json')
}

function resolveAccountPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.json`)
}

// ---------------------------------------------------------------------------
// Account index
// ---------------------------------------------------------------------------

export function listAccountIds(): string[] {
  try {
    if (!fs.existsSync(resolveAccountIndexPath())) return []
    const raw = fs.readFileSync(resolveAccountIndexPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  } catch {
    return []
  }
}

export function registerAccountId(accountId: string): void {
  fs.mkdirSync(path.dirname(resolveAccountIndexPath()), { recursive: true })
  const existing = listAccountIds()
  if (existing.includes(accountId)) return
  fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify([...existing, accountId], null, 2), 'utf-8')
}

export function unregisterAccountId(accountId: string): void {
  const existing = listAccountIds()
  const updated = existing.filter((id) => id !== accountId)
  if (updated.length !== existing.length) {
    fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), 'utf-8')
  }
}

export function clearStaleAccountsForUserId(
  currentAccountId: string,
  userId: string,
  log: PluginLogger,
  onClearContextTokens?: (accountId: string) => void,
): void {
  if (!userId) return
  const allIds = listAccountIds()
  for (const id of allIds) {
    if (id === currentAccountId) continue
    const data = loadAccount(id)
    if (data?.userId?.trim() === userId) {
      log.info(`clearStaleAccountsForUserId: removing stale account=${id} (same userId=${userId})`)
      onClearContextTokens?.(id)
      clearAccount(id)
      unregisterAccountId(id)
    }
  }
}

// ---------------------------------------------------------------------------
// Account store
// ---------------------------------------------------------------------------

export type WeixinAccountData = {
  token?: string
  savedAt?: string
  baseUrl?: string
  userId?: string
}

function readAccountFile(filePath: string): WeixinAccountData | null {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WeixinAccountData
    }
  } catch {
    // ignore
  }
  return null
}

export function loadAccount(accountId: string): WeixinAccountData | null {
  return readAccountFile(resolveAccountPath(accountId))
}

export function saveAccount(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string },
): void {
  const dir = resolveAccountsDir()
  fs.mkdirSync(dir, { recursive: true })

  const existing = loadAccount(accountId) ?? {}
  const token = update.token?.trim() || existing.token
  const baseUrl = update.baseUrl?.trim() || existing.baseUrl
  const userId = update.userId !== undefined
    ? update.userId.trim() || undefined
    : existing.userId?.trim() || undefined

  const data: WeixinAccountData = {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(userId ? { userId } : {}),
  }

  const filePath = resolveAccountPath(accountId)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  try { fs.chmodSync(filePath, 0o600) } catch { /* best-effort */ }
}

export function clearAccount(accountId: string): void {
  const dir = resolveAccountsDir()
  for (const suffix of ['.json', '.sync.json', '.context-tokens.json']) {
    try { fs.unlinkSync(path.join(dir, `${accountId}${suffix}`)) } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

export type ResolvedWeixinAccount = {
  accountId: string
  baseUrl: string
  cdnBaseUrl: string
  token?: string
  enabled: boolean
  configured: boolean
  name?: string
}

export function resolveAccount(
  accountId: string,
  pluginConfig: Readonly<Record<string, unknown>>,
): ResolvedWeixinAccount {
  const accountData = loadAccount(accountId)
  const token = accountData?.token?.trim() || undefined
  const stateBaseUrl = accountData?.baseUrl?.trim() || ''

  const accounts = pluginConfig.accounts as Record<string, Record<string, unknown>> | undefined
  const accountCfg = accounts?.[accountId] ?? {}

  return {
    accountId,
    baseUrl: stateBaseUrl || (pluginConfig.baseUrl as string) || DEFAULT_BASE_URL,
    cdnBaseUrl: (accountCfg.cdnBaseUrl as string) || (pluginConfig.cdnBaseUrl as string) || CDN_BASE_URL,
    token,
    enabled: accountCfg.enabled !== false,
    configured: Boolean(token),
    name: (accountCfg.name as string) || undefined,
  }
}

/** Resolve the first configured and enabled account. */
export function resolveDefaultAccount(
  pluginConfig: Readonly<Record<string, unknown>>,
): ResolvedWeixinAccount | null {
  const ids = listAccountIds()
  for (const id of ids) {
    const account = resolveAccount(id, pluginConfig)
    if (account.enabled && account.configured) return account
  }
  return null
}
