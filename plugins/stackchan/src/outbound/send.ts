import type { WebSocket } from 'ws'
import { SentenceBuffer } from './sentence-buffer'
import type { DeviceServerMessage } from '../types'

export type Synth = (text: string) => Promise<Buffer>

export type OutboundSender = {
  sendChunk(text: string): Promise<void>
  end(): Promise<void>
}

export function createOutboundSender(opts: {
  socket: WebSocket
  synth: Synth
  promptId: string
}): OutboundSender {
  const buf = new SentenceBuffer()
  let started = false

  function emit(payload: DeviceServerMessage): void {
    if (opts.socket.readyState !== 1) return
    opts.socket.send(JSON.stringify(payload))
  }

  function emitBinary(b: Buffer): void {
    if (opts.socket.readyState !== 1) return
    opts.socket.send(b)
  }

  async function flushSentence(text: string): Promise<void> {
    if (!started) {
      started = true
      emit({ type: 'reply.start', promptId: opts.promptId })
    }
    let audio: Buffer | null = null
    try {
      audio = await opts.synth(text)
    } catch {
      audio = null
    }
    emit({
      type: 'reply.sentence',
      promptId: opts.promptId,
      text,
      ttsBytes: audio?.byteLength ?? 0
    })
    if (audio) emitBinary(audio)
  }

  async function sendChunk(text: string): Promise<void> {
    const sentences = buf.feed(text)
    for (const s of sentences) {
      // eslint-disable-next-line no-await-in-loop
      await flushSentence(s)
    }
  }

  async function end(): Promise<void> {
    const remainder = buf.flush()
    if (remainder) await flushSentence(remainder)
    emit({ type: 'reply.end', promptId: opts.promptId })
  }

  return { sendChunk, end }
}
