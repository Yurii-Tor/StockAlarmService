/**
 * MIC to human-readable venue name (OQ-14).
 *
 * Market-data providers return the ISO 10383 MIC (`XNAS`), but acceptance
 * criterion 1 requires a search result to read "NASDAQ". Nobody recognises
 * `XNAS`, so without this map §B.1's result format cannot be produced:
 *
 *     MSFT — Microsoft Corporation
 *     NASDAQ · Stock · USD
 *
 * The seven US venues below cover the entire Finnhub US universe (verified
 * 2026-09-05 across 30,991 symbols). Add entries as exchanges are added.
 */
const MIC_TO_NAME: Readonly<Record<string, string>> = {
  XNAS: 'NASDAQ',
  XNYS: 'NYSE',
  ARCX: 'NYSE Arca',
  XASE: 'NYSE American',
  BATS: 'Cboe BZX',
  IEXG: 'IEX',
  OOTC: 'OTC',

  // Not synced today (only the US universe is), but present so a second
  // market does not immediately render raw MICs to users.
  XLON: 'London Stock Exchange',
  XETR: 'Xetra',
  XFRA: 'Frankfurt',
  XPAR: 'Euronext Paris',
  XAMS: 'Euronext Amsterdam',
  XSWX: 'SIX Swiss',
  XTSE: 'Toronto',
  XTKS: 'Tokyo',
  XHKG: 'Hong Kong',
  XWAR: 'Warsaw',
};

/**
 * Falls back to the MIC itself rather than to a guess or an empty string:
 * showing `XLON` is unhelpful but honest, and it makes the missing mapping
 * visible instead of silently degrading the result.
 */
export function exchangeNameForMic(mic: string | null | undefined): string | null {
  if (!mic) return null;
  return MIC_TO_NAME[mic.toUpperCase()] ?? mic.toUpperCase();
}

export function isKnownMic(mic: string): boolean {
  return mic.toUpperCase() in MIC_TO_NAME;
}
