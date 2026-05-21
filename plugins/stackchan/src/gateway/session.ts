import type { PluginStt, SttStream, SttLanguage } from 'cola-plugin-sdk'

export type SttFactory = PluginStt['createStream']

export type Session = {
  readonly promptId: string
  readonly opened: boolean
  pushAudio(samples: Float32Array): void
  finish(): Promise<string>
  cancel(): void
}

export function createSession(opts: {
  promptId: string
  language: SttLanguage
  stt: SttFactory
  onTranscript: (text: string) => void
  onError: (code: string) => void
}): Session {
  const stream: SttStream | null = opts.stt({ language: opts.language })
  if (!stream) {
    opts.onError('stt_not_ready')
    return {
      promptId: opts.promptId,
      opened: false,
      pushAudio: () => {},
      async finish() {
        throw new Error('stt_not_ready')
      },
      cancel() {}
    }
  }

  stream.onPartial?.((text) => opts.onTranscript(text))
  let cancelled = false

  return {
    promptId: opts.promptId,
    opened: true,
    pushAudio(samples) {
      if (cancelled) return
      stream.push(samples)
    },
    async finish() {
      if (cancelled) throw new Error('session cancelled')
      const text = await stream.finish()
      opts.onTranscript(text)
      return text
    },
    cancel() {
      if (cancelled) return
      cancelled = true
      stream.cancel()
    }
  }
}
