export function int16BufferToFloat32(buf: Buffer): Float32Array {
  if (buf.length % 2 !== 0) {
    throw new Error('int16BufferToFloat32: buffer length must be even')
  }
  const out = new Float32Array(buf.length / 2)
  for (let i = 0, j = 0; i < buf.length; i += 2, j++) {
    const sample = buf.readInt16LE(i)
    out[j] = sample < 0 ? sample / 32768 : sample / 32767
  }
  return out
}
