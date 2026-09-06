import {
  shardKeyForSymbol,
  type DirectoryEntry,
  type DirectoryRefreshOutcome,
  type InstrumentDirectory,
} from '../../app/ports/instrument-directory';

/**
 * KV-backed instrument directory.
 *
 * Entries are stored with short field names. Over ~31,000 entries the verbose
 * form costs roughly a megabyte more across the shards for no benefit, and KV
 * reads are on the request path for every search.
 */
interface StoredEntry {
  s: string;
  n: string;
  t: string;
  m?: string;
  c?: string;
  f?: string;
  i?: string;
}

type Shard = Record<string, StoredEntry>;

/** Bump when the stored shape changes, so old shards are simply ignored. */
const VERSION = 'v1';

function keyFor(shard: string): string {
  return `dir:${VERSION}:${shard}`;
}

function toStored(entry: DirectoryEntry): StoredEntry {
  const stored: StoredEntry = {
    s: entry.symbol,
    n: entry.displayName,
    t: entry.assetType,
  };
  // Omit empty fields rather than storing nulls: across 31,000 entries the
  // difference is real, and absent already means unknown.
  if (entry.mic) stored.m = entry.mic;
  if (entry.currency) stored.c = entry.currency;
  if (entry.figi) stored.f = entry.figi;
  if (entry.isin) stored.i = entry.isin;
  return stored;
}

function fromStored(stored: StoredEntry): DirectoryEntry {
  return {
    symbol: stored.s,
    displayName: stored.n,
    assetType: stored.t,
    mic: stored.m ?? null,
    currency: stored.c ?? null,
    figi: stored.f ?? null,
    isin: stored.i ?? null,
  };
}

export class KvInstrumentDirectory implements InstrumentDirectory {
  constructor(private readonly kv: KVNamespace) {}

  async lookup(symbol: string): Promise<DirectoryEntry | null> {
    const found = await this.lookupMany([symbol]);
    return found.get(symbol.toUpperCase()) ?? null;
  }

  async lookupMany(symbols: readonly string[]): Promise<Map<string, DirectoryEntry>> {
    const result = new Map<string, DirectoryEntry>();
    if (symbols.length === 0) return result;

    // Group by shard so a page of search results costs one read per distinct
    // leading character rather than one read per hit.
    const byShard = new Map<string, string[]>();
    for (const raw of symbols) {
      const symbol = raw.trim().toUpperCase();
      if (!symbol) continue;
      const shard = shardKeyForSymbol(symbol);
      const list = byShard.get(shard);
      if (list) list.push(symbol);
      else byShard.set(shard, [symbol]);
    }

    await Promise.all(
      [...byShard.entries()].map(async ([shard, wanted]) => {
        const data = (await this.kv.get(keyFor(shard), 'json')) as Shard | null;
        if (!data) return;
        for (const symbol of wanted) {
          const hit = data[symbol];
          if (hit) result.set(symbol, fromStored(hit));
        }
      }),
    );

    return result;
  }

  async refresh(entries: readonly DirectoryEntry[]): Promise<DirectoryRefreshOutcome> {
    const shards = new Map<string, Shard>();

    for (const entry of entries) {
      const symbol = entry.symbol.trim().toUpperCase();
      if (!symbol) continue;
      const shardKey = shardKeyForSymbol(symbol);
      let shard = shards.get(shardKey);
      if (!shard) {
        shard = {};
        shards.set(shardKey, shard);
      }
      shard[symbol] = toStored(entry);
    }

    const outcome: DirectoryRefreshOutcome = {
      entries: entries.length,
      shards: shards.size,
      shardsWritten: 0,
      shardsUnchanged: 0,
      kvWrites: 0,
    };

    for (const [shardKey, shard] of shards) {
      const key = keyFor(shardKey);

      // Serialised with sorted keys so the comparison below is deterministic.
      // Relying on provider ordering would make an unchanged shard look
      // changed whenever the upstream list is reordered -- which would spend
      // the KV write budget re-storing identical data, the same class of
      // mistake that caused the original D1 outage.
      const next = JSON.stringify(
        Object.fromEntries(Object.keys(shard).sort().map((k) => [k, shard[k]])),
      );
      const current = await this.kv.get(key, 'text');

      if (current === next) {
        outcome.shardsUnchanged += 1;
        continue;
      }

      await this.kv.put(key, next);
      outcome.shardsWritten += 1;
      outcome.kvWrites += 1;
    }

    return outcome;
  }
}
