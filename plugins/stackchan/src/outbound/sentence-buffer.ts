import { stripEmoji, stripMarkdown } from './strip-markdown'

const SENTENCE_END = /[。！？.!?\n]/
const HAS_SPEAKABLE = /\p{Letter}/u

export class SentenceBuffer {
  private buffer = ''
  private fenceCount = 0
  private backtickRun = 0
  private inInlineCode = false

  private get inCodeBlock(): boolean {
    return this.fenceCount % 2 === 1
  }

  private commitBacktickRun(): void {
    if (this.backtickRun >= 3) {
      this.fenceCount++
      this.inInlineCode = false
    } else if (this.backtickRun > 0) {
      this.inInlineCode = !this.inInlineCode
    }
    this.backtickRun = 0
  }

  feed(delta: string): string[] {
    const sentences: string[] = []

    for (const char of delta) {
      this.buffer += char

      if (char === '`') {
        this.backtickRun++
        continue
      }

      this.commitBacktickRun()

      if (this.inCodeBlock || this.inInlineCode) continue

      if (SENTENCE_END.test(char)) {
        const cleaned = stripEmoji(stripMarkdown(this.buffer.trim()))
        if (cleaned && HAS_SPEAKABLE.test(cleaned)) sentences.push(cleaned)
        this.buffer = ''
      }
    }

    return sentences
  }

  flush(minLength?: number): string | null {
    this.commitBacktickRun()
    if (this.inCodeBlock) return null
    const cleaned = stripEmoji(stripMarkdown(this.buffer.trim()))
    if (minLength && cleaned.length < minLength) return null
    this.buffer = ''
    this.fenceCount = 0
    this.inInlineCode = false
    return (cleaned && HAS_SPEAKABLE.test(cleaned)) ? cleaned : null
  }

  reset(): void {
    this.buffer = ''
    this.fenceCount = 0
    this.backtickRun = 0
    this.inInlineCode = false
  }
}
