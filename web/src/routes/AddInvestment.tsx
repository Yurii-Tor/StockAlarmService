import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TickerSearch } from '../components/TickerSearch';
import { DraftForm } from '../components/DraftForm';
import { api, ApiError } from '../api/client';
import type { CreateItemBody, DraftResponse, SearchResult } from '../api/types';

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
  const instrumentRef = params.get('ref');

  const [intent, setIntent] = useState<'watching' | 'open'>('watching');
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const loadDraft = useCallback(
    async (ref: string, nextIntent: 'watching' | 'open') => {
      setLoading(true);
      setError(null);
      try {
        setDraft(
          await api.draftFromInstrument({
            instrumentRef: ref,
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
    if (instrumentRef) void loadDraft(instrumentRef, intent);
  }, [instrumentRef, intent, loadDraft]);

  function select(result: SearchResult) {
    // Navigation carries the instrument id, so a duplicate ticker resolves to
    // one specific listing rather than a symbol that could mean either (§B.1).
    setParams({ ref: result.instrumentRef });
  }

  async function refreshQuote() {
    if (!instrumentRef) return;
    setRefreshing(true);
    try {
      await api.quote(instrumentRef, true);
      await loadDraft(instrumentRef, intent);
    } finally {
      setRefreshing(false);
    }
  }

  async function save(body: CreateItemBody) {
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});
    try {
      const created = await api.createItem(body);
      navigate(`/items/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.errors.length > 0) {
        // Server-side validation is authoritative; surface it per field
        // rather than replacing it with a generic message.
        setFieldErrors(Object.fromEntries(err.errors.map((e) => [e.field, e.message])));
      } else {
        setSaveError(err instanceof Error ? err.message : 'Could not save');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => (instrumentRef ? setParams({}) : navigate('/'))}
          className="text-sm text-(--color-ink-muted)"
        >
          ← Back
        </button>
        <h1 className="text-lg font-semibold">Add an investment</h1>
      </header>

      {!instrumentRef ? (
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
          onSave={save}
          saving={saving}
          fieldErrors={fieldErrors}
          saveError={saveError}
        />
      ) : null}
    </main>
  );
}
