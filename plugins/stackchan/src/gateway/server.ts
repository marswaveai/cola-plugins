import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import type { GatewayContext, PluginLogger } from 'cola-plugin-sdk'
import type { DeviceClientMessage, DeviceServerMessage, StackChanConfig } from '../types'
import { parseDeviceMessage } from './parse'
import { createDeviceRegistry, type DeviceRegistry } from './devices'

export type StackChanState = {
  registry: DeviceRegistry | null
  server: WebSocketServer | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  statusMessage: string
}

const SERVER_VERSION = '0.1.0'

export const gatewayState: StackChanState = {
  registry: null,
  server: null,
  heartbeatTimer: null,
  statusMessage: 'not started'
}

type CloseCleanup = (socket: WebSocket) => void

function runCleanupOnClose(state: StackChanState, socket: WebSocket): void {
  const hook = (state as { cleanupOnClose?: CloseCleanup }).cleanupOnClose
  if (typeof hook === 'function') hook(socket)
}

export async function startGateway(
  ctx: GatewayContext<StackChanState>,
  config: StackChanConfig
): Promise<void> {
  const registry = createDeviceRegistry({ now: () => Date.now() })
  gatewayState.registry = registry
  ctx.state.registry = registry

  const server = new WebSocketServer({
    host: config.host,
    port: config.port,
    path: config.path
  })

  server.on('connection', (socket) => {
    socket.on('message', (data) => {
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

  ctx.abortSignal.addEventListener('abort', () => stopGateway(gatewayState), { once: true })
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
  if (raw instanceof Buffer && !looksLikeJson(raw)) {
    // Binary frame outside an audio window — ignore in this phase.
    return
  }
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
    default:
      // audio.* handled in M2.
      send(socket, { type: 'error', code: 'unsupported', message: `not implemented: ${(message as DeviceClientMessage).type}` })
  }
}

function looksLikeJson(buf: Buffer): boolean {
  if (buf.length === 0) return false
  const first = buf[0]!
  return first === 0x7b /* { */ || first === 0x5b /* [ */
}

export function send(socket: WebSocket, payload: DeviceServerMessage): void {
  if (socket.readyState !== 1 /* OPEN */) return
  socket.send(JSON.stringify(payload))
}

export function logHello(logger: PluginLogger): void {
  logger.info('stackchan gateway helpers loaded')
}
