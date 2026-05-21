import { describe, expect, it } from 'vitest'
import { int16BufferToFloat32 } from '../../src/audio/pcm'

describe('int16BufferToFloat32', () => {
  it('maps int16 min/max to floats near ±1', () => {
    const buf = Buffer.alloc(4)
    buf.writeInt16LE(-32768, 0)
    buf.writeInt16LE(32767, 2)
    const out = int16BufferToFloat32(buf)
    expect(out.length).toBe(2)
    expect(out[0]).toBeCloseTo(-1, 4)
    expect(out[1]).toBeCloseTo(1, 4)
  })

  it('throws on odd byte length', () => {
    expect(() => int16BufferToFloat32(Buffer.alloc(3))).toThrow(/even/i)
  })

  it('handles empty buffer', () => {
    expect(int16BufferToFloat32(Buffer.alloc(0))).toEqual(new Float32Array(0))
  })
})
