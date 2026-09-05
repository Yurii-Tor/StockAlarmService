import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TickerSearch } from '../components/TickerSearch';
import { DraftForm } from '../components/DraftForm';
import { api } from '../api/client';
import type { DraftResponse, SearchResult } from '../api/types';

/**
 * The quick-add flow (§B.1 → §C.1).
 *
 * Two steps sharing one route so the chosen instrument is deep-linkable:
 * search, then a prefilled draft. Selecting an instrument immediately calls
 * the draft API (§B.2: "Immediately after the user selects an instrument,
 * call an asset-details/quote endpoint and prefill the draft item").
 */
export function AddInvestment() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const instrumentId = params.get('instrumentId');

  const [intent, setIntent] = useState<'watching' | 'open'>('watching');
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDraft = useCallback(
    async (id: string, nextIntent: 'watching' | 'open') => {
      setLoading(true);
      setError(null);
      try {
        setDraft(
          await api.draftFromInstrument({
            instrumentId: id,
            intent: nextIntent,
            // The browser knows the device zone; the server owns the account
            // default. Sending it means a draft created while travelling
            // still records the zone the user is actually in.
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not build the draft');
        setDraft(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (instrumentId) void loadDraft(instrumentId, intent);
  }, [instrumentId, intent, loadDraft]);

  function select(result: SearchResult) {
    // Navigation carries the instrument id, so a duplicate ticker resolves to
    // one specific listing rather than a symbol that could mean either (§B.1).
    setParams({ instrumentId: result.instrumentId });
  }

  async function refreshQuote() {
    if (!instrumentId) return;
    setRefreshing(true);
    try {
      await api.quote(instrumentId, true);
      await loadDraft(instrumentId, intent);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => (instrumentId ? setParams({}) : navigate('/'))}
          className="text-sm text-(--color-ink-muted)"
        >
          ← Back
        </button>
        <h1 className="text-lg font-semibold">Add an investment</h1>
      </header>

      {!instrumentId ? (
        <TickerSearch onSelect={select} autoFocus />
      ) : loading ? (
        <p className="text-sm text-(--color-ink-muted)">Loading instrument…</p>
      ) : error ? (
        <div className="rounded-xl border border-(--color-border-subtle) p-4">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <Link to="/add" onClick={() => setParams({})} className="mt-2 inline-block text-xs underline">
            Choose a different instrument
          </Link>
        </div>
      ) : draft ? (
        <DraftForm
          draft={draft}
          intent={intent}
          onIntentChange={setIntent}
          onRefreshQuote={refreshQuote}
          refreshing={refreshing}
        />
      ) : null}
    </main>
  );
}
