import type { CachedQuote, CallBudget, QuoteCache } from '../../app/ports/quote-cache';

/**
 * KV-backed quote cache and provider call budget.
 *
 * Both live in KV rather than D1 on purpose (ASM-028): a quote refresh and a
 * rate-limit counter are disposable, and routing them through D1 would spend
 * the 100k/day row-write budget on data nobody will ever query historically.
 */

export class KvQuoteCache implements QuoteCache {
  constructor(private readonly kv: KVNamespace) {}

  private key(instrumentId: string): string {
    return `quote:${instrumentId}`;
  }

  async get(instrumentId: string): Promise<CachedQuote | null> {
    // KV is eventually consistent and can return a value written elsewhere
    // moments ago -- fine here, because the record carries `retrievedAt` and
    // freshness is recomputed from it on every read.
    const raw = await this.kv.get(this.key(instrumentId), 'json');
    return (raw as CachedQuote | null) ?? null;
  }

  async set(instrumentId: string, quote: CachedQuote, ttlSeconds: number): Promise<void> {
    // KV enforces a 60s floor on expirationTtl.
    const ttl = Math.max(60, ttlSeconds);
    await this.kv.put(this.key(instrumentId), JSON.stringify(quote), { expirationTtl: ttl });
  }
}

/**
 * Fixed-window per-minute call budget.
 *
 * Deliberately approximate: the window resets on a wall-clock minute, so a
 * burst can straddle two windows. That is acceptable because the goal is to
 * stay clear of the provider's limit, not to ration exactly -- and the
 * alternative (a sliding window in KV) costs more writes than it saves calls.
 */
export class KvCallBudget implements CallBudget {
  constructor(
    private readonly kv: KVNamespace,
    private readonly nowMs: () => number,
  ) {}

  async tryConsume(provider: string, limitPerMinute: number): Promise<boolean> {
    const minute = Math.floor(this.nowMs() / 60_000);
    const key = `budget:${provider}:${minute}`;

    const current = Number((await this.kv.get(key)) ?? '0');
    if (current >= limitPerMinute) return false;

    // Not atomic. Two concurrent requests can both read the same count, so
    // the effective ceiling can drift slightly above the limit. The limit is
    // set below the provider's actual cap precisely to absorb that.
    await this.kv.put(key, String(current + 1), { expirationTtl: 120 });
    return true;
  }
}
