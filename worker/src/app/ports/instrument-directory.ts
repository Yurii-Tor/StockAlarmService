/**
 * The instrument directory.
 *
 * This exists because of a real incident. The directory used to live in D1 as
 * ~31,000 rows, seeded in one pass. D1 bills index and FTS shadow maintenance
 * as row writes, so that seed cost 177,888 billable writes -- 178% of the
 * daily free-tier budget -- and because the limit is enforced per ACCOUNT it
 * took an unrelated project offline for four hours.
 *
 * The deeper problem was not the size of the write. It was writing 31,000
 * rows to serve a user who adds perhaps 10-50 instruments a year: roughly 600
 * times more data than the product needs.
 *
 * So the directory moved to KV and D1 now stores only instruments the user
 * actually saved:
 *
 *   - KV has no index or shadow-table amplification, and its own write budget
 *     (1,000/day) is separate from D1's.
 *   - The directory is sharded by leading symbol character, so a lookup reads
 *     one shard rather than the universe.
 *   - Refresh writes only shards whose contents changed -- typically zero.
 *   - A row lands in D1 when, and only when, the user saves an item.
 */

export interface DirectoryEntry {
  symbol: string;
  displayName: string;
  assetType: string;
  /** ISO 10383 MIC. The venue key that makes §B.1 disambiguation possible. */
  mic: string | null;
  currency: string | null;
  figi: string | null;
  isin: string | null;
}

export interface DirectoryRefreshOutcome {
  /** Entries considered across every configured exchange. */
  entries: number;
  shards: number;
  shardsWritten: number;
  shardsUnchanged: number;
  /** KV writes this refresh cost. Budget is 1,000/day on the free plan. */
  kvWrites: number;
}

export interface InstrumentDirectory {
  /** Exact-symbol lookup. One KV read. */
  lookup(symbol: string): Promise<DirectoryEntry | null>;

  /**
   * Batch lookup. Groups symbols by shard so enriching a page of search
   * results costs one read per distinct leading character, not one per hit.
   */
  lookupMany(symbols: readonly string[]): Promise<Map<string, DirectoryEntry>>;

  /**
   * Replaces the ENTIRE directory with `entries`, writing only shards that
   * changed.
   *
   * "Entire" is load-bearing. Shards are keyed by leading symbol character,
   * not by exchange, so `VOD` (NASDAQ) and `VOD.L` (London) share shard `V`.
   * Refreshing one exchange at a time therefore deletes the other's symbols
   * from every shared shard. Callers must pass every exchange at once.
   *
   * Deliberately compares before writing. The symbol universe is almost
   * static day to day, so a naive rewrite would spend the entire KV write
   * budget re-storing identical data -- the same mistake, in a different
   * store, that caused the original outage.
   */
  refresh(entries: readonly DirectoryEntry[]): Promise<DirectoryRefreshOutcome>;
}

/**
 * Shard key for a symbol.
 *
 * Leading character, uppercased; anything not A-Z or 0-9 shares one bucket.
 * That gives ~37 shards over the US universe, a few hundred KB each -- far
 * inside KV's 25 MB value limit, with room for further exchanges before any
 * shard needs splitting.
 */
export function shardKeyForSymbol(symbol: string): string {
  const first = symbol.trim().charAt(0).toUpperCase();
  return /^[A-Z0-9]$/.test(first) ? first : '_';
}
