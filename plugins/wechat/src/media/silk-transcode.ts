import type { PluginLogger } from 'cola-plugin-sdk'

const SILK_SAMPLE_RATE = 24_000

function pcmBytesToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const pcmBytes = pcm.byteLength
  const totalSize = 44 + pcmBytes
  const buf = Buffer.allocUnsafe(totalSize)
  let offset = 0

  buf.write('RIFF', offset); offset += 4
  buf.writeUInt32LE(totalSize - 8, offset); offset += 4
  buf.write('WAVE', offset); offset += 4

  buf.write('fmt ', offset); offset += 4
  buf.writeUInt32LE(16, offset); offset += 4
  buf.writeUInt16LE(1, offset); offset += 2
  buf.writeUInt16LE(1, offset); offset += 2
  buf.writeUInt32LE(sampleRate, offset); offset += 4
  buf.writeUInt32LE(sampleRate * 2, offset); offset += 4
  buf.writeUInt16LE(2, offset); offset += 2
  buf.writeUInt16LE(16, offset); offset += 2

  buf.write('data', offset); offset += 4
  buf.writeUInt32LE(pcmBytes, offset); offset += 4

  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset)
  return buf
}

/**
 * Transcode SILK audio to WAV.
 * Returns WAV buffer on success, null if silk-wasm is unavailable or decoding fails.
 */
export async function silkToWav(silkBuf: Buffer, log: PluginLogger): Promise<Buffer | null> {
  try {
    const { decode } = await import('silk-wasm')
    // silk-wasm decode returns { data: Uint8Array, duration: number }
    // Note: decode is synchronous despite returning a Promise-like in some versions.
    const result = decode(silkBuf, SILK_SAMPLE_RATE)
    const resolved = await result
    log.info(`silkToWav: decoded duration=${resolved.duration}ms pcmBytes=${resolved.data.byteLength}`)
    return pcmBytesToWav(resolved.data, SILK_SAMPLE_RATE)
  } catch (err) {
    log.warn(`silkToWav: transcode failed, will use raw silk err=${String(err)}`)
    return null
  }
}
