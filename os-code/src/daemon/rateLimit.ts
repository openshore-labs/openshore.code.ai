// A small per-address token bucket (H1), for the one daemon route that answers
// without a credential: POST /pair/claim. A pairing claim is 96 random bits
// and is spent on first use, so guessing is already hopeless; the bucket makes
// it slow as well, and keeps a flood of claim attempts from one address from
// costing the daemon anything. In memory only: a restart forgets it, which is
// fine for a door this narrow.

export interface BucketOptions {
  /** Attempts an address may make in a burst. */
  capacity: number;
  /** One attempt comes back every this many milliseconds. */
  refillMs: number;
  /** Addresses remembered at most; the fullest are forgotten first. */
  maxKeys?: number;
}

export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly maxKeys: number;

  constructor(private readonly opts: BucketOptions) {
    this.maxKeys = opts.maxKeys ?? 1024;
  }

  /** Spend one attempt for this key. Answers whether it was allowed and, when
   *  not, how long until the next one comes back. */
  take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
    const b = this.refilled(key, now);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      this.trim();
      return { ok: true };
    }
    this.buckets.set(key, b);
    const retryAfterMs = Math.ceil((1 - b.tokens) * this.opts.refillMs);
    return { ok: false, retryAfterMs };
  }

  private refilled(key: string, now: number): { tokens: number; at: number } {
    const prev = this.buckets.get(key);
    if (!prev) return { tokens: this.opts.capacity, at: now };
    const tokens = Math.min(
      this.opts.capacity,
      prev.tokens + Math.max(0, now - prev.at) / this.opts.refillMs,
    );
    return { tokens, at: now };
  }

  /** Keep the map small: past the cap, forget the addresses closest to full
   *  (they would be allowed again anyway). */
  private trim(): void {
    if (this.buckets.size <= this.maxKeys) return;
    const byFullness = [...this.buckets.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
    for (const [key] of byFullness.slice(0, this.buckets.size - this.maxKeys)) {
      this.buckets.delete(key);
    }
  }
}
