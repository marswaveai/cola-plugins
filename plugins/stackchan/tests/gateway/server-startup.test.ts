import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { AddressInfo } from 'node:net'
import { gatewayState, startGateway, stopGateway } from '../../src/gateway/server'
import type { GatewayContext } from 'cola-plugin-sdk'

describe('startGateway integration', () => {
  let ctx: GatewayContext<typeof gatewayState>
  let abort: AbortController

  afterEach(async () => {
    stopGateway(gatewayState)
    abort?.abort()
  })

  it('initializes state maps so audio.start does not crash', async () => {
    abort = new AbortController()
    ctx = {
      config: { host: '127.0.0.1', port: 0, path: '/stackchan' } as any,
      runtime: {
        identity: { resolve: vi.fn(async () => 'user-1'), bind: vi.fn(), unbind: vi.fn() },
        config: { get: () => ({}) },
        events: { on: () => () => {} },
        stt: {
          createStream: () => ({
            push() {},
            async finish() { return 'hi' },
            cancel() {}
          })
        },
        logger: { info() {}, warn() {}, error() {} },
        version: 'test'
      } as any,
      logger: { info() {}, warn() {}, error() {} },
      abortSignal: abort.signal,
      state: {} as any,  // <-- the bug: host passes an empty object
      deliver: vi.fn(async () => {})
    } as any

    // Read config from the ctx; pass a fixed port via env/inline
    const port = await new Promise<number>((resolve) => {
      const srv = new WebSocketServer({ port: 0 })
      srv.on('listening', () => {
        const p = (srv.address() as AddressInfo).port
        srv.close(() => resolve(p))
      })
    })
    ;(ctx.config as any).port = port

    await startGateway(ctx, {
      host: '127.0.0.1',
      port,
      path: '/stackchan',
      heartbeatMs: 60_000,
      staleAfterMs: 300_000,
      requireToken: false,
      token: '',
      accessToken: '',
      speakerId: '',
      language: 'auto',
      ttsBaseUrl: 'https://api.example/v1'
    })

    // After startGateway, ctx.state.sessions etc. must be real Maps (not undefined).
    expect(ctx.state.sessions).toBeInstanceOf(Map)
    expect(ctx.state.senders).toBeInstanceOf(Map)
    expect(ctx.state.sendersByDevice).toBeInstanceOf(Map)
    expect(gatewayState.sessions).toBe(ctx.state.sessions)
  })
})
