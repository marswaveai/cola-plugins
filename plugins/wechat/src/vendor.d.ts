declare module 'qrcode-terminal' {
  const qrcode: {
    generate(text: string, options?: { small?: boolean }, callback?: (qr: string) => void): void
  }
  export default qrcode
}

declare module 'silk-wasm' {
  export function decode(input: Buffer, sampleRate: number): Promise<{
    data: Uint8Array
    duration: number
  }>
}
