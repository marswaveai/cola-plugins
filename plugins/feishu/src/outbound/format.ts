/**
 * Format text for Feishu outbound — uses post format with md tag for markdown support.
 */
export function formatAsPost(text: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: 'md', text }]],
    },
  })
}

/**
 * Format a simple text message (no markdown).
 */
export function formatAsText(text: string): string {
  return JSON.stringify({ text })
}
