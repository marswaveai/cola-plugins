import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config'

describe('readConfig', () => {
  it('returns defaults for empty input', () => {
    const cfg = readConfig({})
    expect(cfg.host).toBe('0.0.0.0')
    expect(cfg.port).toBe(19540)
    expect(cfg.path).toBe('/stackchan')
    expect(cfg.heartbeatMs).toBe(30_000)
    expect(cfg.staleAfterMs).toBe(75_000)
    expect(cfg.requireToken).toBe(false)
    expect(cfg.token).toBe('')
    expect(cfg.accessToken).toBe('')
    expect(cfg.speakerId).toBe('')
    expect(cfg.language).toBe('auto')
    expect(cfg.ttsBaseUrl).toBe('https://api.marswave.ai/openapi/v1')
  })

  it('honors overrides and normalizes path', () => {
    const cfg = readConfig({
      host: '127.0.0.1',
      port: 9000,
      path: 'devices',
      heartbeatMs: 10_000,
      requireToken: true,
      token: 'secret',
      accessToken: 'abc',
      speakerId: 'voice-1',
      language: 'zh',
      ttsBaseUrl: 'https://staging.marswave.ai/openapi/v1/'
    })
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.port).toBe(9000)
    expect(cfg.path).toBe('/devices')
    expect(cfg.requireToken).toBe(true)
    expect(cfg.token).toBe('secret')
    expect(cfg.accessToken).toBe('abc')
    expect(cfg.speakerId).toBe('voice-1')
    expect(cfg.language).toBe('zh')
    expect(cfg.ttsBaseUrl).toBe('https://staging.marswave.ai/openapi/v1')
  })

  it('falls back to defaults on invalid numbers and unknown language', () => {
    const cfg = readConfig({ port: 'abc', heartbeatMs: -1, language: 'xx' })
    expect(cfg.port).toBe(19540)
    expect(cfg.heartbeatMs).toBe(30_000)
    expect(cfg.language).toBe('auto')
    // readString trims whitespace and falls back when blank
    expect(readConfig({ host: '   ' }).host).toBe('0.0.0.0')
    // readPort rejects out-of-range numbers
    expect(readConfig({ port: 70000 }).port).toBe(19540)
    // readLanguage rejects empty string and falls back
    expect(readConfig({ language: '' }).language).toBe('auto')
  })
})
