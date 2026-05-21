import { describe, expect, it } from 'vitest'
import { parseDeviceMessage } from '../../src/gateway/parse'

describe('parseDeviceMessage', () => {
  it('parses hello', () => {
    const msg = parseDeviceMessage(
      JSON.stringify({ type: 'hello', deviceId: 'dev-1', name: 'Bob', token: 't' })
    )
    expect(msg).toEqual({ type: 'hello', deviceId: 'dev-1', name: 'Bob', token: 't' })
  })

  it('rejects hello missing deviceId', () => {
    expect(parseDeviceMessage(JSON.stringify({ type: 'hello' }))).toBeNull()
  })

  it('parses audio.start with sampleRate default applied at use site', () => {
    const msg = parseDeviceMessage(
      JSON.stringify({ type: 'audio.start', promptId: 'p1', language: 'zh' })
    )
    expect(msg).toEqual({ type: 'audio.start', promptId: 'p1', language: 'zh' })
  })

  it('rejects audio.start missing promptId', () => {
    expect(parseDeviceMessage(JSON.stringify({ type: 'audio.start' }))).toBeNull()
  })

  it('parses audio.end', () => {
    const msg = parseDeviceMessage(
      JSON.stringify({ type: 'audio.end', promptId: 'p1', samplesTotal: 48000 })
    )
    expect(msg).toEqual({ type: 'audio.end', promptId: 'p1', samplesTotal: 48000 })
  })

  it('parses pong', () => {
    expect(parseDeviceMessage(JSON.stringify({ type: 'pong', timestamp: 42 }))).toEqual({
      type: 'pong',
      timestamp: 42
    })
  })

  it('parses status (promptId on top level, extras under details)', () => {
    const msg = parseDeviceMessage(
      JSON.stringify({ type: 'status', battery: 88, promptId: 'p1' })
    )
    expect(msg).toEqual({
      type: 'status',
      promptId: 'p1',
      details: { battery: 88 }
    })
  })

  it('parses status without extras (no details field)', () => {
    const msg = parseDeviceMessage(JSON.stringify({ type: 'status' }))
    expect(msg).toEqual({ type: 'status' })
  })

  it('returns null for invalid json', () => {
    expect(parseDeviceMessage('not json')).toBeNull()
  })

  it('returns null for unknown type', () => {
    expect(parseDeviceMessage(JSON.stringify({ type: 'made-up' }))).toBeNull()
  })
})
