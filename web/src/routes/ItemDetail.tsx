import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { ItemDetail as Item } from '../api/types';
import { instrumentSubtitle } from '../lib/format';

/**
 * One investment item: position, thesis, and the history of that thesis.
 *
 * The thesis editor saves a new version rather than replacing the old one
 * (FR-054) — the point of the product is being able to read what you actually
 * thought at the time, not what you have since talked yourself into.
 */
export function ItemDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thesis, setThesis] = useState('');
  const [savingThesis, setSavingThesis] = useState(false);
  const [versions, setVersions] = useState<
    Array<{ versionNo: number; body: string; changeSummary: string | null }> | null
  >(null);

  const load = useCallback(async () => {
    try {
      const detail = await api.getItem(id);
      setItem(detail);
      setThesis(detail.thesis?.body ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this item');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveThesis() {
    setSavingThesis(true);
    try {
      await api.saveThesis(id, thesis);
      setVersions(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the thesis');
    } finally {
      setSavingThesis(false);
    }
  }

  async function remove() {
    await api.deleteItem(id);
    navigate('/');
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <Link to="/" className="mt-3 inline-block text-xs underline">
          Back to portfolio
        </Link>
      </main>
    );
  }

  if (!item) {
    return <main className="mx-auto max-w-2xl px-5 py-8 text-sm text-(--color-ink-muted)">Loading…</main>;
  }

  const unchanged = thesis.trim() === (item.thesis?.body ?? '').trim();

  return (
    <main className="mx-auto max-w-2xl px-5 py-8 space-y-6">
      <header className="flex items-start gap-3">
        <Link to="/" className="text-sm text-(--color-ink-muted)">
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">
            {item.symbol} — {item.displayName}
          </h1>
          <p className="text-xs text-(--color-ink-muted)">
            {instrumentSubtitle(item.exchange, item.assetType, item.currency)}
          </p>
        </div>
      </header>

      {item.lots.length > 0 ? (
        <section
          data-testid="position"
          className="rounded-2xl border border-(--color-border-subtle) bg-(--color-surface-raised) p-4"
        >
          <h2 className="mb-2 text-sm font-medium">Position</h2>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-[11px] text-(--color-ink-muted)">Quantity</dt>
              <dd className="tnum">{item.totalQuantity}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-(--color-ink-muted)">Avg entry</dt>
              <dd className="tnum">{item.averageEntryPrice}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-(--color-ink-muted)">Fees</dt>
              <dd className="tnum">{item.totalFees}</dd>
            </div>
          </dl>
          {/* No cross-currency totals anywhere (FR-053): an item has one
              currency, and items are never summed together. */}
          <p className="mt-2 text-[11px] text-(--color-ink-muted)">
            All figures in {item.currency}.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-(--color-border-subtle) p-4 text-center text-sm text-(--color-ink-muted)">
          Watching — no position recorded.
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Thesis</h2>
          {item.thesis ? (
            <span className="text-[11px] text-(--color-ink-muted)">
              version {item.thesis.currentVersionNo} of {item.thesis.versionCount}
            </span>
          ) : null}
        </div>

        <textarea
          data-testid="thesis-editor"
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          placeholder="What do you expect, and what would prove you wrong?"
          className="min-h-40 w-full rounded-lg border border-(--color-border-subtle) bg-(--color-surface-raised) px-3 py-2 text-sm outline-none focus:border-(--color-accent)"
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="save-thesis"
            disabled={savingThesis || unchanged || thesis.trim() === ''}
            onClick={() => void saveThesis()}
            className="rounded-lg bg-(--color-accent) px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {savingThesis ? 'Saving…' : item.thesis ? 'Save new version' : 'Save thesis'}
          </button>

          {item.thesis && item.thesis.versionCount > 1 ? (
            <button
              type="button"
              data-testid="show-history"
              onClick={async () => {
                const r = await api.thesisVersions(id);
                setVersions(r.versions);
              }}
              className="text-xs underline"
            >
              History
            </button>
          ) : null}
        </div>

        {/* Editing never overwrites: earlier versions stay readable exactly as
            written (FR-054, §E.3). */}
        {versions ? (
          <ol data-testid="thesis-history" className="mt-3 space-y-3">
            {versions.map((v) => (
              <li key={v.versionNo} className="rounded-lg border border-(--color-border-subtle) p-3">
                <p className="mb-1 text-[11px] text-(--color-ink-muted)">
                  Version {v.versionNo}
                  {v.changeSummary ? ` — ${v.changeSummary}` : ''}
                </p>
                <p className="whitespace-pre-wrap text-xs">{v.body}</p>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <section>
        <button
          type="button"
          data-testid="delete-item"
          onClick={() => void remove()}
          className="text-xs text-red-600 underline dark:text-red-400"
        >
          Delete this item
        </button>
      </section>
    </main>
  );
}
