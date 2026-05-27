/** Strip markdown formatting, returning plain text suitable for notifications and TTS. */
export function stripMarkdown(text: string): string {
  return (
    text
      // Phase 1 – block-level structures (remove entire lines)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^\|.*\|$/gm, '')
      .replace(/^[\s]{0,3}(?:[-*_]\s*){3,}$/gm, '')
      .replace(/^\[([^\]]*)\]:\s+\S+.*$/gm, '')

      // Phase 2 – inline structures with URLs
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')

      // Phase 3 – list markers and structural prefixes
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, '')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*(?:>\s*)+/gm, '')

      // Phase 4 – inline characters and escapes
      .replace(/\[\^[^\]]*\]/g, '')
      .replace(/\\([*_~`[\]\\#>|!{}\-+.])/g, '$1')
      .replace(/[*_~]/g, '')
      .replace(/\|/g, '')

      // Phase 5 – whitespace normalization
      .replace(/\n{2,}/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  )
}

/** Remove emoji characters from text. Used by TTS pipeline only. */
export function stripEmoji(text: string): string {
  return text.replace(/\p{Extended_Pictographic}/gu, '').replace(/[ \t]{2,}/g, ' ').trim()
}
