import type { StackChanConfig, StackChanConfigInput } from './types'

const SUPPORTED_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'auto'] as const

export function readConfig(input: StackChanConfigInput): StackChanConfig {
  return {
    host: readString(input.host, '0.0.0.0'),
    port: readPort(input.port, 19540),
    path: normalizePath(readString(input.path, '/stackchan')),
    heartbeatMs: readPositiveInt(input.heartbeatMs, 30_000),
    staleAfterMs: readPositiveInt(input.staleAfterMs, 75_000),
    requireToken: readBoolean(input.requireToken, false),
    token: readString(input.token, ''),
    accessToken: readString(input.accessToken, ''),
    speakerId: readString(input.speakerId, ''),
    language: readLanguage(input.language),
    ttsBaseUrl: trimTrailingSlash(
      readString(input.ttsBaseUrl, 'https://api.marswave.ai/openapi/v1')
    )
  }
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function readPositiveInt(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback
}

function readPort(value: unknown, fallback: number): number {
  const num = readPositiveInt(value, fallback)
  return num >= 1 && num <= 65_535 ? num : fallback
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function readLanguage(value: unknown): StackChanConfig['language'] {
  if (typeof value !== 'string') return 'auto'
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
    ? (value as StackChanConfig['language'])
    : 'auto'
}
