import { afterEach, describe, expect, it, vi } from 'vitest'
import { synthesize } from '../../src/outbound/tts-client'

const fetchSpy = vi.fn()
vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

afterEach(() => {
  fetchSpy.mockReset()
})

describe('synthesize', () => {
  it('posts to /tts and returns the audio buffer', async () => {
    const audio = new Uint8Array([0xff, 0xfb])
    fetchSpy.mockResolvedValueOnce(
      new Response(audio, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    )
    const buf = await synthesize({
      baseUrl: 'https://api.example/openapi/v1',
      accessToken: 'tok',
      speakerId: 'spk',
      language: 'zh',
      text: 'hi'
    })
    expect(buf).toEqual(Buffer.from(audio))
    const call = fetchSpy.mock.calls[0]!
    const url = call[0] as string
    const init = call[1] as RequestInit
    expect(url).toBe('https://api.example/openapi/v1/tts')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body as string)).toEqual({
      input: 'hi',
      voice: 'spk',
      language: 'zh'
    })
  })

  it('throws on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('bad', { status: 401 }))
    await expect(
      synthesize({
        baseUrl: 'https://api.example/openapi/v1',
        accessToken: 'tok',
        speakerId: 'spk',
        language: 'zh',
        text: 'hi'
      })
    ).rejects.toThrow(/401/)
  })
})
