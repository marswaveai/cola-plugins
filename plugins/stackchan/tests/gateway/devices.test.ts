import { describe, expect, it, vi } from 'vitest'
import { createDeviceRegistry } from '../../src/gateway/devices'

function fakeSocket() {
  return {
    closed: false,
    closeCode: 0,
    closeReason: '',
    sent: [] as string[],
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
    const sock1 = fakeSocket() as unknown as import('ws').WebSocket
    const sock2 = fakeSocket() as unknown as import('ws').WebSocket

    reg.register(sock1, { deviceId: 'dev-1', name: 'A' })
    expect(reg.list()).toHaveLength(1)

    reg.register(sock2, { deviceId: 'dev-1', name: 'A2' })
    expect((sock1 as unknown as ReturnType<typeof fakeSocket>).closed).toBe(true)
    expect(reg.list()).toHaveLength(1)
    expect(reg.find('dev-1')?.name).toBe('A2')
  })

  it('forgets device when its socket is dropped', () => {
    const reg = createDeviceRegistry({ now: () => 1000 })
    const sock = fakeSocket() as unknown as import('ws').WebSocket
    reg.register(sock, { deviceId: 'dev-1' })
    reg.forget(sock)
    expect(reg.list()).toHaveLength(0)
  })

  it('updates lastSeen on touch', () => {
    let t = 1000
    const reg = createDeviceRegistry({ now: () => t })
    const sock = fakeSocket() as unknown as import('ws').WebSocket
    reg.register(sock, { deviceId: 'dev-1' })
    t = 2000
    reg.touch(sock)
    expect(reg.find('dev-1')?.lastSeen).toBe(2000)
  })

  it('evicts stale devices and pings live ones via callback', () => {
    let t = 0
    const reg = createDeviceRegistry({ now: () => t })
    const sockA = fakeSocket() as unknown as import('ws').WebSocket
    const sockB = fakeSocket() as unknown as import('ws').WebSocket
    reg.register(sockA, { deviceId: 'A' })
    reg.register(sockB, { deviceId: 'B' })
    t = 1000
    reg.touch(sockB)
    t = 5000

    const pinged = vi.fn()
    reg.tick({ pingPayload: { type: 'ping', timestamp: t }, staleAfterMs: 4000, onPing: pinged })

    expect((sockA as unknown as ReturnType<typeof fakeSocket>).closed).toBe(true)
    expect((sockB as unknown as ReturnType<typeof fakeSocket>).closed).toBe(false)
    expect(pinged).toHaveBeenCalledTimes(1)
    expect(reg.list()).toHaveLength(1)
  })
})
