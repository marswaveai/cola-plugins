import { describe, expect, it, vi } from 'vitest'
import { createOutboundSender } from '../../src/outbound/send'

function fakeSocket() {
  const sent: Array<string | Buffer> = []
  return {
    readyState: 1,
    sent,
    send(p: string | Buffer) {
      sent.push(p)
    }
  }
}

describe('createOutboundSender', () => {
  it('splits sentences, synthesizes each, emits reply.sentence + binary + reply.end', async () => {
    const sock = fakeSocket() as unknown as import('ws').WebSocket
    const synth = vi
      .fn()
      .mockResolvedValueOnce(Buffer.from([1, 2]))
      .mockResolvedValueOnce(Buffer.from([3, 4, 5]))
    const sender = createOutboundSender({ socket: sock, synth, promptId: 'p1' })

    await sender.sendChunk('你好。')
    await sender.sendChunk('再见。')
    await sender.end()

    const sentRaw = (sock as unknown as ReturnType<typeof fakeSocket>).sent
    const json = sentRaw.filter((x): x is string => typeof x === 'string').map((s: string) => JSON.parse(s))
    const bin = sentRaw.filter((x): x is Buffer => x instanceof Buffer)

    expect(json[0]).toEqual({ type: 'reply.start', promptId: 'p1' })
    expect(json[1]).toEqual({ type: 'reply.sentence', promptId: 'p1', text: '你好。', ttsBytes: 2 })
    expect(bin[0]).toEqual(Buffer.from([1, 2]))
    expect(json[2]).toEqual({ type: 'reply.sentence', promptId: 'p1', text: '再见。', ttsBytes: 3 })
    expect(bin[1]).toEqual(Buffer.from([3, 4, 5]))
    expect(json.at(-1)).toEqual({ type: 'reply.end', promptId: 'p1' })
  })

  it('emits ttsBytes=0 when synth throws', async () => {
    const sock = fakeSocket() as unknown as import('ws').WebSocket
    const synth = vi.fn().mockRejectedValueOnce(new Error('boom'))
    const sender = createOutboundSender({ socket: sock, synth, promptId: 'p1' })
    await sender.sendChunk('hello.')
    await sender.end()
    const json = (sock as unknown as ReturnType<typeof fakeSocket>).sent
      .filter((x): x is string => typeof x === 'string')
      .map((s: string) => JSON.parse(s))
    expect(json).toContainEqual({
      type: 'reply.sentence',
      promptId: 'p1',
      text: 'hello.',
      ttsBytes: 0
    })
  })
})
