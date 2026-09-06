import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { ItemSummary, Me } from '../api/types';
import { instrumentSubtitle } from '../lib/format';

export function Dashboard({ me }: { me: Me }) {
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listItems()
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load'));
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Portfolio</h1>
        <p className="text-xs text-(--color-ink-muted)">{me.user.email}</p>
      </header>

      <Link
        to="/add"
        data-testid="add-investment"
        className="block rounded-xl bg-(--color-accent) px-4 py-3 text-center text-sm font-semibold text-white"
      >
        Add an investment
      </Link>

      {error ? <p className="mt-4 text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      {items === null && !error ? (
        <p className="mt-8 text-sm text-(--color-ink-muted)">Loading…</p>
      ) : null}

      {items?.length === 0 ? (
        <section className="mt-8 rounded-xl border border-dashed border-(--color-border-subtle) p-6 text-center">
          <p className="text-sm text-(--color-ink-muted)">
            Nothing here yet. Add something you are watching, or something you have bought — a
            review reminder is entirely optional.
          </p>
        </section>
      ) : null}

      {items && items.length > 0 ? (
        <ul data-testid="item-list" className="mt-6 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={`/items/${item.id}`}
                data-testid={`item-${item.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-(--color-border-subtle) bg-(--color-surface-raised) px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {item.symbol} — {item.displayName}
                  </span>
                  <span className="block text-xs text-(--color-ink-muted)">
                    {instrumentSubtitle(item.exchange, item.assetType, item.currency)}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  {item.status === 'open' && item.totalQuantity ? (
                    <>
                      <span className="block text-sm tnum">{item.totalQuantity}</span>
                      <span className="block text-[11px] text-(--color-ink-muted) tnum">
                        avg {item.averageEntryPrice} {item.currency}
                      </span>
                    </>
                  ) : (
                    <span className="rounded-full bg-(--color-ink-muted)/12 px-2 py-0.5 text-[11px]">
                      Watching
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
