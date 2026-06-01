const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Simple in-memory message deduplication with TTL */
export class MessageDedup {
  private seen = new Map<string, number>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Returns true if message_id was already seen (duplicate) */
  isDuplicate(messageId: string): boolean {
    const now = Date.now();
    this.cleanup(now);

    if (this.seen.has(messageId)) return true;
    this.seen.set(messageId, now);
    return false;
  }

  private cleanup(now: number): void {
    for (const [id, ts] of this.seen) {
      if (now - ts > this.ttlMs) this.seen.delete(id);
    }
  }
}
