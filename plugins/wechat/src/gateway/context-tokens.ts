import fs from 'node:fs'
import path from 'node:path'

import { getPluginDir } from '../auth/accounts.js'

/**
 * In-memory + disk-persisted context token store.
 * Each WeChat conversation has a context_token that must be sent with replies.
 */

const tokens = new Map<string, string>()

function makeKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`
}

function resolveTokenFilePath(accountId: string): string {
  return path.join(getPluginDir(), 'accounts', `${accountId}.context-tokens.json`)
}

export function setContextToken(accountId: string, userId: string, token: string): void {
  tokens.set(makeKey(accountId, userId), token)
  persistContextTokens(accountId)
}

export function getContextToken(accountId: string, userId: string): string | undefined {
  return tokens.get(makeKey(accountId, userId))
}

export function restoreContextTokens(accountId: string): void {
  const filePath = resolveTokenFilePath(accountId)
  try {
    if (!fs.existsSync(filePath)) return
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Record<string, string>
    for (const [userId, token] of Object.entries(data)) {
      if (typeof token === 'string' && token) {
        tokens.set(makeKey(accountId, userId), token)
      }
    }
  } catch {
    // ignore corrupt file
  }
}

export function clearContextTokensForAccount(accountId: string): void {
  const prefix = `${accountId}:`
  for (const key of tokens.keys()) {
    if (key.startsWith(prefix)) tokens.delete(key)
  }
  try { fs.unlinkSync(resolveTokenFilePath(accountId)) } catch { /* ignore */ }
}

function persistContextTokens(accountId: string): void {
  const prefix = `${accountId}:`
  const data: Record<string, string> = {}
  for (const [key, token] of tokens) {
    if (key.startsWith(prefix)) {
      data[key.slice(prefix.length)] = token
    }
  }
  const filePath = resolveTokenFilePath(accountId)
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8')
  } catch {
    // best-effort
  }
}
