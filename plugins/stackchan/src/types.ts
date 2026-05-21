export type StackChanConfig = {
  host: string
  port: number
  path: string
  heartbeatMs: number
  staleAfterMs: number
  requireToken: boolean
  token: string
  accessToken: string
  speakerId: string
  language: 'zh' | 'en' | 'ja' | 'ko' | 'auto'
  ttsBaseUrl: string
}

export type DeviceClientMessage =
  | { type: 'hello'; deviceId: string; name?: string; firmwareVersion?: string; token?: string }
  | { type: 'audio.start'; promptId: string; language?: string; sampleRate?: number }
  | { type: 'audio.end'; promptId: string; samplesTotal?: number }
  | { type: 'pong'; timestamp?: number }
  | { type: 'status'; promptId?: string; [key: string]: unknown }

export type DeviceServerMessage =
  | { type: 'hello.ok'; serverVersion: string }
  | { type: 'hello.err'; code: string; message: string }
  | { type: 'ack'; messageType: string; promptId?: string; timestamp: number }
  | { type: 'audio.ready'; promptId: string }
  | { type: 'transcript.partial'; promptId: string; text: string }
  | { type: 'transcript.final'; promptId: string; text: string }
  | { type: 'reply.start'; promptId: string }
  | { type: 'reply.sentence'; promptId: string; text: string; ttsBytes: number }
  | { type: 'reply.end'; promptId: string }
  | { type: 'ping'; timestamp: number }
  | { type: 'error'; code: string; message: string; promptId?: string }

export type StackChanConfigInput = Readonly<Record<string, unknown>>
