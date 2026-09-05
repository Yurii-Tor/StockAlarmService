/**
 * Presentation helpers shared by the search results and the asset card, so
 * the same instrument never renders two different ways.
 */

/**
 * `as of 2026-09-03 12:35 EEST` (§B.2).
 *
 * Uses explicit component options rather than dateStyle/timeStyle: the Intl
 * spec forbids combining those shortcuts with `timeZoneName`, and doing so
 * throws. That failure was silent here -- the catch below returned the raw
 * ISO string, so the UI showed `2026-09-05T13:51:12.975Z` instead of a local
 * time, which is exactly the provenance §B.2 asks to be legible.
 */
export function formatAsOf(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** `stock` -> `Stock`, `etf` -> `ETF`. Matches the server's search lines. */
export function formatAssetType(assetType: string): string {
  if (assetType === 'etf' || assetType === 'reit') return assetType.toUpperCase();
  return assetType.charAt(0).toUpperCase() + assetType.slice(1);
}

/** `NASDAQ · Stock · USD` — the second line of §B.1's result format. */
export function instrumentSubtitle(
  exchange: string | null,
  assetType: string,
  currency: string | null,
): string {
  return [exchange, formatAssetType(assetType), currency]
    .filter((p): p is string => Boolean(p))
    .join(' · ');
}
