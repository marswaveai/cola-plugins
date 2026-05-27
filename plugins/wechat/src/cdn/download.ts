import type { PluginLogger } from '@marswave/cola-plugin-sdk'
import { decryptAesEcb } from './aes-ecb.js'

export function buildCdnDownloadUrl(encryptedQueryParam: string, cdnBaseUrl: string): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`
}

async function fetchCdnBytes(url: string, label: string, log: PluginLogger): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)')
    const msg = `${label}: CDN download ${res.status} ${res.statusText} body=${body}`
    log.error(msg)
    throw new Error(msg)
  }
  return Buffer.from(await res.arrayBuffer())
}

function parseAesKey(aesKeyBase64: string, label: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, 'base64')
  if (decoded.length === 16) return decoded
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex')
  }
  throw new Error(
    `${label}: aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes`,
  )
}

export async function downloadAndDecryptBuffer(
  encryptedQueryParam: string,
  aesKeyBase64: string,
  cdnBaseUrl: string,
  label: string,
  log: PluginLogger,
  fullUrl?: string,
): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64, label)
  const url = fullUrl || buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl)
  const encrypted = await fetchCdnBytes(url, label, log)
  return decryptAesEcb(encrypted, key)
}

export async function downloadPlainCdnBuffer(
  encryptedQueryParam: string,
  cdnBaseUrl: string,
  label: string,
  log: PluginLogger,
  fullUrl?: string,
): Promise<Buffer> {
  const url = fullUrl || buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl)
  return fetchCdnBytes(url, label, log)
}
