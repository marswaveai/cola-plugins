import { describe, expect, it, vi } from 'vitest'
import { createSession, type SttFactory } from '../../src/gateway/session'

function fakeStt(transcript: string): SttFactory {
  return () => {
    const pushed: number[] = []
    return {
      push(samples) {
        pushed.push(samples.length)
      },
      finish: vi.fn(async () => transcript),
      cancel: vi.fn(),
      onPartial: () => () => {}
    }
  }
}

describe('createSession', () => {
  it('opens stream, accepts audio, returns transcript on end', async () => {
    const stt = fakeStt('你好世界')
    const sess = createSession({
      promptId: 'p1',
      language: 'zh',
      stt,
      onTranscript: vi.fn(),
      onError: vi.fn()
    })
    expect(sess.opened).toBe(true)
    sess.pushAudio(new Float32Array(1280))
    sess.pushAudio(new Float32Array(1280))
    const text = await sess.finish()
    expect(text).toBe('你好世界')
  })

  it('returns null transcript when stt factory returns null', async () => {
    const stt: SttFactory = () => null
    const onError = vi.fn()
    const sess = createSession({
      promptId: 'p1',
      language: 'auto',
      stt,
      onTranscript: vi.fn(),
      onError
    })
    expect(sess.opened).toBe(false)
    expect(onError).toHaveBeenCalledWith('stt_not_ready')
    await expect(sess.finish()).rejects.toThrow(/stt_not_ready/)
  })

  it('cancel makes finish reject', async () => {
    const sess = createSession({
      promptId: 'p1',
      language: 'auto',
      stt: fakeStt('hi'),
      onTranscript: vi.fn(),
      onError: vi.fn()
    })
    sess.cancel()
    await expect(sess.finish()).rejects.toThrow(/cancel/i)
  })
})
