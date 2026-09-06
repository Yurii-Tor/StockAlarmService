import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { SearchResponse, SearchResult } from '../api/types';

/**
 * Ticker/name search (§B.1).
 *
 * The flow starts here, with one input -- not a form and not an asset-type
 * picker (FR-010).
 *
 * The rule that shapes this component: "If multiple listings share a symbol,
 * the user must choose the specific listing. Never automatically assume a
 * ticker is unique across all exchanges." That is enforced as a guard, not a
 * layout choice: `onSelect` is refused for an ambiguous symbol unless the
 * click was an explicit pick from the list.
 */

const DEBOUNCE_MS = 250;

export function TickerSearch({
  onSelect,
  autoFocus,
}: {
  onSelect: (result: SearchResult) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setData(null);
      setError(null);
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      api
        .searchInstruments(trimmed, controller.signal)
        .then((response) => {
          setData(response);
          setError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setData(null);
          setError(err instanceof Error ? err.message : 'Search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const results = data?.results ?? [];

  return (
    <div>
      <label htmlFor="ticker-search" className="block text-sm font-medium mb-2">
        Ticker or company name
      </label>
      <input
        id="ticker-search"
        data-testid="ticker-search"
        type="search"
        inputMode="search"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="MSFT, Microsoft, VOD…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-xl border border-(--color-border-subtle) bg-(--color-surface-raised) px-4 py-3 text-base outline-none focus:border-(--color-accent)"
      />

      <div className="mt-2 min-h-5" aria-live="polite">
        {loading ? <p className="text-xs text-(--color-ink-muted)">Searching…</p> : null}
        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        {!loading && !error && query.trim() && results.length === 0 ? (
          <p className="text-xs text-(--color-ink-muted)">
            No matching instruments. You can still add it as a custom asset.
          </p>
        ) : null}
      </div>

      {data?.requiresDisambiguation ? (
        <p
          data-testid="disambiguation-notice"
          className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          This ticker exists on more than one exchange. Choose the listing you mean — they are
          different instruments, priced in different currencies.
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul data-testid="search-results" className="divide-y divide-(--color-border-subtle) rounded-xl border border-(--color-border-subtle) overflow-hidden">
          {results.map((result) => (
            <li key={result.instrumentRef}>
              <button
                type="button"
                data-testid={`result-${result.instrumentRef}`}
                onClick={() => onSelect(result)}
                className="flex w-full flex-col items-start gap-0.5 bg-(--color-surface-raised) px-4 py-3 text-left hover:bg-(--color-accent)/8 focus:bg-(--color-accent)/8 focus:outline-none"
              >
                {/* §B.1's exact two-line format, assembled by the server so
                    every client renders identically. */}
                <span className="font-medium">{result.primaryLine}</span>
                <span className="flex items-center gap-2 text-xs text-(--color-ink-muted)">
                  {result.secondaryLine}
                  {result.isAmbiguousSymbol ? (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
                      duplicate ticker
                    </span>
                  ) : null}
                  {!result.metadataKnown ? (
                    <span className="rounded bg-(--color-ink-muted)/15 px-1.5 py-0.5 text-[10px]">
                      venue unknown
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
