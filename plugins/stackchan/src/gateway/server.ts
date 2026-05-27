import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import type { GatewayContext, PluginLogger, SttLanguage } from '@marswave/cola-plugin-sdk'
import type { DeviceClientMessage, DeviceServerMessage, StackChanConfig } from '../types'
import { parseDeviceMessage } from './parse'
import { createDeviceRegistry, type DeviceRegistry } from './devices'
import { createSession } from './session'
import type { Session } from './session'
import { int16BufferToFloat32 } from '../audio/pcm'
import type { OutboundSender } from '../outbound/send'

export type StackChanState = {
  registry: DeviceRegistry | null
  server: WebSocketServer | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  statusMessage: string
  sessions: Map<string, Session>
  senders: Map<string, OutboundSender>      // keyed by promptId
  sendersByDevice: Map<string, Set<string>> // deviceId → set of promptIds
  cleanupOnClose?: (socket: WebSocket) => void
  /** Cola-host-provided TTS synthesizer. Returns 16 kHz mono WAV bytes. */
  hostTtsSynthesize?: (text: string, opts?: { language?: 'zh' | 'en' }) => Promise<Buffer | null>
}

const SERVER_VERSION = '0.1.0'

export const gatewayState: StackChanState = {
  registry: null,
  server: null,
  heartbeatTimer: null,
  statusMessage: 'not started',
  sessions: new Map(),
  senders: new Map(),
  sendersByDevice: new Map()
}

// flushTimers is co-located here so cleanupDeviceTurn can clear them on disconnect,
// preventing timer leaks. index.ts imports scheduleFlush instead of defining it locally.
const FLUSH_DELAY_MS = 1500
export const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function scheduleFlush(
  state: StackChanState,
  promptId: string,
  deviceId: string
): void {
  clearTimeout(flushTimers.get(promptId))
  const t = setTimeout(() => {
    const sender = state.senders.get(promptId)
    if (!sender) return
    void sender.end()
    state.senders.delete(promptId)
    state.sendersByDevice.get(deviceId)?.delete(promptId)
    flushTimers.delete(promptId)
  }, FLUSH_DELAY_MS)
  flushTimers.set(promptId, t)
}

function runCleanupOnClose(state: StackChanState, socket: WebSocket): void {
  if (typeof state.cleanupOnClose === 'function') state.cleanupOnClose(socket)
}

export async function startGateway(
  ctx: GatewayContext<StackChanState>,
  config: StackChanConfig
): Promise<void> {
  const registry = createDeviceRegistry({ now: () => Date.now() })
  gatewayState.registry = registry
  ctx.state.registry = registry
  // The plugin host initializes ctx.state = {} (an empty object), so the Maps
  // declared on StackChanState are absent at startup.  Ensure they exist before
  // mirroring them onto gatewayState.
  const s = ctx.state as Partial<StackChanState>
  s.sessions ??= new Map()
  s.senders ??= new Map()
  s.sendersByDevice ??= new Map()
  gatewayState.sessions = ctx.state.sessions
  gatewayState.senders = ctx.state.senders
  gatewayState.sendersByDevice = ctx.state.sendersByDevice

  ctx.state.cleanupOnClose = (sock) => {
    const id = ctx.state.registry?.resolveDeviceId(sock)
    if (id) cleanupDeviceTurn(ctx.state, id)
  }
  gatewayState.cleanupOnClose = ctx.state.cleanupOnClose

  // Pull TTS synthesizer from the host runtime so outbound can use Cola's
  // accessToken without the user having to paste credentials in plugin config.
  const hostTts = ctx.runtime.tts
  if (hostTts?.synthesize) {
    gatewayState.hostTtsSynthesize = hostTts.synthesize.bind(hostTts)
    ctx.state.hostTtsSynthesize = gatewayState.hostTtsSynthesize
    ctx.logger.info('stackchan: using host-provided TTS (runtime.tts.synthesize)')
  } else {
    ctx.logger.warn('stackchan: host TTS unavailable; outbound will use plugin config or fall back to text-only')
  }

  const server = new WebSocketServer({
    host: config.host,
    port: config.port,
    path: config.path
  })

  server.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        handleBinaryFrame(ctx.state, socket, data as Buffer)
        return
      }
      void handleMessage(ctx, config, registry, socket, data)
    })
    socket.on('close', () => {
      runCleanupOnClose(ctx.state, socket)
      registry.forget(socket)
    })
    socket.on('error', (err) => {
      ctx.logger.warn('stackchan socket error', err)
      runCleanupOnClose(ctx.state, socket)
      registry.forget(socket)
    })
  })

  server.on('error', (err) => {
    gatewayState.statusMessage = `error: ${err.message}`
    ctx.state.statusMessage = gatewayState.statusMessage
    ctx.logger.error('stackchan server error', err)
  })

  gatewayState.server = server
  ctx.state.server = server
  gatewayState.statusMessage = `listening on ws://${config.host}:${config.port}${config.path}`
  ctx.state.statusMessage = gatewayState.statusMessage
  ctx.logger.info(`stackchan ${gatewayState.statusMessage}`)

  const heartbeatTimer = setInterval(() => {
    registry.tick({
      pingPayload: { type: 'ping', timestamp: Date.now() },
      staleAfterMs: config.staleAfterMs
    })
  }, config.heartbeatMs)

  gatewayState.heartbeatTimer = heartbeatTimer
  ctx.state.heartbeatTimer = heartbeatTimer

  ctx.abortSignal.addEventListener('abort', () => stopGateway(ctx.state), { once: true })
}

export function stopGateway(state: StackChanState): void {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer)
  state.heartbeatTimer = null
  state.registry?.list().forEach((d) => d.socket.close(1001, 'gateway stopped'))
  state.registry = null
  state.server?.close()
  state.server = null
  state.statusMessage = 'stopped'
  // Keep gatewayState in sync when stopGateway is called on ctx.state
  if (state !== gatewayState) {
    gatewayState.heartbeatTimer = null
    gatewayState.registry = null
    gatewayState.server = null
    gatewayState.statusMessage = 'stopped'
  }
}

async function handleMessage(
  ctx: GatewayContext<StackChanState>,
  config: StackChanConfig,
  registry: DeviceRegistry,
  socket: WebSocket,
  raw: RawData
): Promise<void> {
  const message = parseDeviceMessage(raw as Buffer | string)
  if (!message) {
    send(socket, { type: 'error', code: 'bad_request', message: 'invalid frame' })
    return
  }

  switch (message.type) {
    case 'hello': {
      if (config.requireToken && message.token !== config.token) {
        send(socket, { type: 'hello.err', code: 'unauthorized', message: 'bad token' })
        socket.close(1008, 'unauthorized')
        return
      }
      registry.register(socket, {
        deviceId: message.deviceId,
        name: message.name,
        firmwareVersion: message.firmwareVersion
      })
      send(socket, { type: 'hello.ok', serverVersion: SERVER_VERSION })
      ctx.logger.info(`stackchan device connected: ${message.deviceId}`)
      return
    }
    case 'prompt': {
      const deviceId = registry.resolveDeviceId(socket)
      if (!deviceId) {
        send(socket, { type: 'error', code: 'no_hello', message: 'send hello first' })
        return
      }
      const bound = await ctx.runtime.identity.resolve(deviceId)
      if (!bound) {
        send(socket, {
          type: 'error',
          code: 'unbound',
          message: `device ${deviceId} not bound`
        })
        return
      }
      registry.touch(socket)
      await ctx.deliver({
        sessionId: ['stackchan', deviceId],
        sender: { id: deviceId, name: registry.find(deviceId)?.name ?? 'StackChan' },
        deliveryContext: { to: deviceId },
        message: message.text
      })
      send(socket, {
        type: 'ack',
        messageType: 'prompt',
        promptId: message.promptId,
        timestamp: Date.now()
      })
      return
    }
    case 'pong':
      registry.touch(socket)
      return
    case 'status':
      registry.touch(socket)
      registry.recordStatus(socket, message.details ?? {})
      send(socket, {
        type: 'ack',
        messageType: 'status',
        promptId: message.promptId,
        timestamp: Date.now()
      })
      return
    case 'audio.start':
    case 'audio.end':
      await handleAudioMessage(ctx, registry, socket, message)
      return
    default:
      send(socket, { type: 'error', code: 'unsupported', message: `not implemented: ${(message as DeviceClientMessage).type}` })
  }
}

/**
 * Cleans up any audio session and outbound senders for the given device.
 * Called on socket close to prevent leaking sessions/streams/timers from
 * disconnected devices.
 */
export function cleanupDeviceTurn(state: StackChanState, deviceId: string): void {
  const session = state.sessions.get(deviceId)
  if (session) {
    session.cancel()
    state.sessions.delete(deviceId)
  }
  const promptIds = state.sendersByDevice.get(deviceId)
  if (promptIds) {
    for (const id of promptIds) {
      state.senders.delete(id)
      const timer = flushTimers.get(id)
      if (timer) {
        clearTimeout(timer)
        flushTimers.delete(id)
      }
    }
    state.sendersByDevice.delete(deviceId)
  }
}

export async function handleAudioMessage(
  ctx: GatewayContext<StackChanState>,
  registry: DeviceRegistry,
  socket: WebSocket,
  message: Extract<DeviceClientMessage, { type: 'audio.start' | 'audio.end' }>
): Promise<void> {
  const deviceId = registry.resolveDeviceId(socket)
  if (!deviceId) {
    send(socket, { type: 'error', code: 'no_hello', message: 'send hello first' })
    return
  }
  const bound = await ctx.runtime.identity.resolve(deviceId)
  if (!bound) {
    send(socket, { type: 'error', code: 'unbound', message: `device ${deviceId} not bound` })
    return
  }

  if (message.type === 'audio.start') {
    if (ctx.state.sessions.has(deviceId)) {
      send(socket, { type: 'error', code: 'busy', message: 'audio session in progress' })
      return
    }
    const language = (message.language as SttLanguage | undefined) ?? 'auto'
    const session = createSession({
      promptId: message.promptId,
      language,
      stt: ctx.runtime.stt.createStream,
      onTranscript: (text) =>
        send(socket, { type: 'transcript.partial', promptId: message.promptId, text }),
      onError: (code) =>
        send(socket, { type: 'error', code, message: code, promptId: message.promptId })
    })
    if (!session.opened) return
    ctx.state.sessions.set(deviceId, session)
    send(socket, { type: 'audio.ready', promptId: message.promptId })
    return
  }

  if (message.type === 'audio.end') {
    const session = ctx.state.sessions.get(deviceId)
    if (!session || session.promptId !== message.promptId) {
      send(socket, { type: 'error', code: 'no_session', message: 'no matching audio session' })
      return
    }
    try {
      const text = await session.finish()
      send(socket, { type: 'transcript.final', promptId: message.promptId, text })
      await ctx.deliver({
        sessionId: ['stackchan', deviceId],
        sender: { id: deviceId, name: registry.find(deviceId)?.name ?? 'StackChan' },
        deliveryContext: { to: deviceId },
        message: text
      })
    } catch (err) {
      ctx.logger.error('stackchan stt failed', err)
      send(socket, {
        type: 'error',
        code: 'stt_failed',
        message: 'transcription failed',
        promptId: message.promptId
      })
    } finally {
      ctx.state.sessions.delete(deviceId)
    }
    return
  }
}

export function handleBinaryFrame(
  state: StackChanState,
  socket: WebSocket,
  buf: Buffer
): void {
  const deviceId = state.registry?.resolveDeviceId(socket)
  if (!deviceId) return
  const session = state.sessions.get(deviceId)
  if (!session) return
  const samples = int16BufferToFloat32(buf)
  session.pushAudio(samples)
}

export function send(socket: WebSocket, payload: DeviceServerMessage): void {
  if (socket.readyState !== 1 /* OPEN */) return
  socket.send(JSON.stringify(payload))
}

export function logHello(logger: PluginLogger): void {
  logger.info('stackchan gateway helpers loaded')
}
