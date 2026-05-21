import { describe, expect, it, vi } from 'vitest'
import { createDeviceRegistry } from '../../src/gateway/devices'

type FakeSocket = {
  closed: boolean
  closeCode: number
  closeReason: string
  sent: string[]
  readyState: number
  send(payload: string): void
  close(code: number, reason?: string): void
}

function fakeSocket(): FakeSocket {
  return {
    closed: false,
    closeCode: 0,
    closeReason: '',
    sent: [],
    readyState: 1,
    send(payload: string) {
      this.sent.push(payload)
    },
    close(code: number, reason?: string) {
      this.closed = true
      this.closeCode = code
      this.closeReason = reason ?? ''
    }
  }
}

describe('createDeviceRegistry', () => {
  it('registers a new device and replaces previous socket on duplicate id', () => {
    const reg = createDeviceRegistry({ now: () => 1000 })
    const sock1 = fakeSocket()
    const sock2 = fakeSocket()

    reg.register(sock1 as unknown as import('ws').WebSocket, { deviceId: 'dev-1', name: 'A' })
    expect(reg.list()).toHaveLength(1)

    reg.register(sock2 as unknown as import('ws').WebSocket, { deviceId: 'dev-1', name: 'A2' })
    expect(sock1.closed).toBe(true)
    expect(reg.list()).toHaveLength(1)
    expect(reg.find('dev-1')?.name).toBe('A2')
  })

  it('forgets device when its socket is dropped', () => {
    const reg = createDeviceRegistry({ now: () => 1000 })
    const sock = fakeSocket()
    reg.register(sock as unknown as import('ws').WebSocket, { deviceId: 'dev-1' })
    reg.forget(sock as unknown as import('ws').WebSocket)
    expect(reg.list()).toHaveLength(0)
  })

  it('updates lastSeen on touch', () => {
    let t = 1000
    const reg = createDeviceRegistry({ now: () => t })
    const sock = fakeSocket()
    reg.register(sock as unknown as import('ws').WebSocket, { deviceId: 'dev-1' })
    t = 2000
    reg.touch(sock as unknown as import('ws').WebSocket)
    expect(reg.find('dev-1')?.lastSeen).toBe(2000)
  })

  it('evicts stale devices and pings live ones via callback', () => {
    let t = 0
    const reg = createDeviceRegistry({ now: () => t })
    const sockA = fakeSocket()
    const sockB = fakeSocket()
    reg.register(sockA as unknown as import('ws').WebSocket, { deviceId: 'A' })
    reg.register(sockB as unknown as import('ws').WebSocket, { deviceId: 'B' })
    t = 1000
    reg.touch(sockB as unknown as import('ws').WebSocket)
    t = 5000

    const pinged = vi.fn()
    reg.tick({ pingPayload: { type: 'ping', timestamp: t }, staleAfterMs: 4000, onPing: pinged })

    expect(sockA.closed).toBe(true)
    expect(sockB.closed).toBe(false)
    expect(pinged).toHaveBeenCalledTimes(1)
    expect(reg.list()).toHaveLength(1)
  })

  it('keeps device whose lastSeen is exactly at the cutoff (strict-< boundary)', () => {
    let t = 0
    const reg = createDeviceRegistry({ now: () => t })
    const sock = fakeSocket()
    reg.register(sock as unknown as import('ws').WebSocket, { deviceId: 'edge' })  // lastSeen = 0
    t = 4000
    const pinged = vi.fn()
    // cutoff = 4000 - 4000 = 0; lastSeen=0 is NOT < 0 → device survives.
    reg.tick({ pingPayload: { type: 'ping', timestamp: t }, staleAfterMs: 4000, onPing: pinged })
    expect(sock.closed).toBe(false)
    expect(reg.list()).toHaveLength(1)
    expect(pinged).toHaveBeenCalledTimes(1)
  })

  it('returns early when staleAfterMs is non-positive or NaN', () => {
    const reg = createDeviceRegistry({ now: () => 1000 })
    const sock = fakeSocket()
    reg.register(sock as unknown as import('ws').WebSocket, { deviceId: 'guard' })
    const pinged = vi.fn()
    reg.tick({ pingPayload: { type: 'ping', timestamp: 1000 }, staleAfterMs: 0, onPing: pinged })
    reg.tick({ pingPayload: { type: 'ping', timestamp: 1000 }, staleAfterMs: -100, onPing: pinged })
    reg.tick({ pingPayload: { type: 'ping', timestamp: 1000 }, staleAfterMs: NaN, onPing: pinged })
    expect(sock.closed).toBe(false)
    expect(reg.list()).toHaveLength(1)
    expect(pinged).not.toHaveBeenCalled()
  })
})
