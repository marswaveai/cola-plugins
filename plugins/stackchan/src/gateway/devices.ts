import type { WebSocket } from 'ws'
import type { DeviceServerMessage } from '../types'

export type Device = {
  socket: WebSocket
  deviceId: string
  name?: string
  firmwareVersion?: string
  lastSeen: number
  lastStatus?: Record<string, unknown>
}

export type DeviceRegistry = {
  register(
    socket: WebSocket,
    info: { deviceId: string; name?: string; firmwareVersion?: string }
  ): Device
  forget(socket: WebSocket): void
  touch(socket: WebSocket): void
  find(deviceId: string): Device | undefined
  list(): Device[]
  recordStatus(socket: WebSocket, status: Record<string, unknown>): void
  tick(opts: {
    pingPayload: DeviceServerMessage
    staleAfterMs: number
    onPing?: (device: Device) => void
  }): void
  resolveDeviceId(socket: WebSocket): string | undefined
}

export function createDeviceRegistry(opts: { now: () => number }): DeviceRegistry {
  const devices = new Map<string, Device>()
  const socketToId = new WeakMap<WebSocket, string>()

  function register(socket: WebSocket, info: { deviceId: string; name?: string; firmwareVersion?: string }): Device {
    const existing = devices.get(info.deviceId)
    if (existing && existing.socket !== socket) {
      existing.socket.close(1000, 'Replaced by a new StackChan connection')
    }
    socketToId.set(socket, info.deviceId)
    const device: Device = {
      socket,
      deviceId: info.deviceId,
      name: info.name,
      firmwareVersion: info.firmwareVersion,
      lastSeen: opts.now()
    }
    devices.set(info.deviceId, device)
    return device
  }

  function forget(socket: WebSocket): void {
    const id = socketToId.get(socket)
    if (!id) return
    const device = devices.get(id)
    if (device?.socket === socket) devices.delete(id)
    socketToId.delete(socket)
  }

  function touch(socket: WebSocket): void {
    const id = socketToId.get(socket)
    if (!id) return
    const device = devices.get(id)
    if (device?.socket === socket) device.lastSeen = opts.now()
  }

  function find(deviceId: string): Device | undefined {
    return devices.get(deviceId)
  }

  function list(): Device[] {
    return [...devices.values()]
  }

  function recordStatus(socket: WebSocket, status: Record<string, unknown>): void {
    const id = socketToId.get(socket)
    if (!id) return
    const device = devices.get(id)
    if (device?.socket === socket) device.lastStatus = status
  }

  function resolveDeviceId(socket: WebSocket): string | undefined {
    return socketToId.get(socket)
  }

  function tick(args: {
    pingPayload: DeviceServerMessage
    staleAfterMs: number
    onPing?: (device: Device) => void
  }): void {
    const cutoff = opts.now() - args.staleAfterMs
    for (const device of [...devices.values()]) {
      if (device.lastSeen < cutoff) {
        device.socket.close(1001, 'StackChan heartbeat timeout')
        devices.delete(device.deviceId)
        socketToId.delete(device.socket)
        continue
      }
      try {
        device.socket.send(JSON.stringify(args.pingPayload))
        args.onPing?.(device)
      } catch {
        // socket may be in the middle of closing; ignore — eviction will handle it next tick.
      }
    }
  }

  return {
    register,
    forget,
    touch,
    find,
    list,
    recordStatus,
    tick,
    resolveDeviceId
  }
}
