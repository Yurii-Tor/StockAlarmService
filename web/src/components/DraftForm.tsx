import { useState } from 'react';
import type { DraftResponse } from '../api/types';
import { FreshnessBadge, PriceLine, QuoteProvenance } from './FreshnessBadge';
import { instrumentSubtitle } from '../lib/format';

/**
 * The quick-add form (§C.1).
 *
 * Order is taken from the spec rather than chosen: selected asset card,
 * intent selector, conditional purchase section, decision summary, save.
 *
 * The governing rule is §A -- the user supplies only what the system cannot
 * know. Everything here arrives prefilled from the draft API, and every
 * purchase field stays editable because a broker fill legitimately differs
 * from a market quote (§C.1 item 3).
 */

export interface DraftFormProps {
  draft: DraftResponse;
  intent: 'watching' | 'open';
  onIntentChange: (intent: 'watching' | 'open') => void;
  onRefreshQuote: () => void;
  refreshing: boolean;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-(--color-ink-muted)">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-(--color-ink-muted)">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-(--color-border-subtle) bg-(--color-surface-raised) px-3 py-2 text-sm outline-none focus:border-(--color-accent)';

export function DraftForm({
  draft,
  intent,
  onIntentChange,
  onRefreshQuote,
  refreshing,
}: DraftFormProps) {
  const item = draft.investmentItemDraft;
  const lot = draft.lotDraft;

  // Local edits start from the server's proposal. Everything is editable
  // except what identifies the instrument -- changing that means picking a
  // different listing (§B.2 editability table).
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState(lot?.entryPrice ?? '');
  const [fees, setFees] = useState(lot?.fees ?? '0');
  const [broker, setBroker] = useState(lot?.brokerName ?? '');
  const [thesis, setThesis] = useState('');

  const quantityMissing = intent === 'open' && quantity.trim() === '';
  const priceMissing = intent === 'open' && entryPrice.trim() === '';

  return (
    <div className="space-y-6">
      {/* 1. Selected asset card */}
      <section
        data-testid="asset-card"
        className="rounded-2xl border border-(--color-border-subtle) bg-(--color-surface-raised) p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {item.symbol} — {item.name}
            </h2>
            <p className="text-xs text-(--color-ink-muted)">
              {instrumentSubtitle(item.exchange, item.assetType, item.currency)}
            </p>
          </div>
          <FreshnessBadge quote={draft.quote} />
        </div>

        <div className="mt-3">
          <PriceLine quote={draft.quote} />
          <QuoteProvenance
            quote={draft.quote}
            exchange={item.exchange}
            timeZone={item.timezone}
          />
        </div>

        {draft.quote.price === null ? (
          <button
            type="button"
            onClick={onRefreshQuote}
            disabled={refreshing}
            data-testid="retry-quote"
            className="mt-3 rounded-lg border border-(--color-border-subtle) px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {refreshing ? 'Retrying…' : 'Retry price'}
          </button>
        ) : null}

        {!item.isMonitorable ? (
          <p className="mt-3 rounded-lg bg-(--color-ink-muted)/10 px-3 py-2 text-xs">
            Price alerts are unavailable for this asset — it cannot be monitored by the data
            provider. Reviews and journal notes work as normal.
          </p>
        ) : null}
      </section>

      {/* 2. Intent selector */}
      <section>
        <h3 className="mb-2 text-sm font-medium">Are you holding this?</h3>
        <div
          role="radiogroup"
          aria-label="Intent"
          className="grid grid-cols-2 gap-2"
          data-testid="intent-selector"
        >
          {(
            [
              ['watching', 'Watching'],
              ['open', 'I bought it'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={intent === value}
              data-testid={`intent-${value}`}
              onClick={() => onIntentChange(value)}
              className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                intent === value
                  ? 'border-(--color-accent) bg-(--color-accent)/10'
                  : 'border-(--color-border-subtle) bg-(--color-surface-raised)'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* 3. Purchase section — only for "I bought it" */}
      {intent === 'open' && lot ? (
        <section data-testid="purchase-section" className="space-y-3">
          <h3 className="text-sm font-medium">Purchase</h3>

          <Field label="Quantity (required)">
            <input
              data-testid="quantity"
              className={inputClass}
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="How many?"
              aria-required="true"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Entry price"
              hint={
                lot.entryPriceSource === 'latest_quote'
                  ? 'Prefilled from the latest quote — correct it to your actual fill.'
                  : 'No quote was available, so enter what you paid.'
              }
            >
              <input
                data-testid="entry-price"
                className={`${inputClass} tnum`}
                inputMode="decimal"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
              />
            </Field>

            <Field label="Fees">
              <input
                data-testid="fees"
                className={`${inputClass} tnum`}
                inputMode="decimal"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Bought at">
              <input
                data-testid="bought-at"
                className={inputClass}
                readOnly
                value={new Date(lot.boughtAt).toLocaleString()}
              />
            </Field>
            <Field label="Broker">
              <input
                data-testid="broker"
                className={inputClass}
                value={broker}
                onChange={(e) => setBroker(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </div>
        </section>
      ) : null}

      {/* 4. Decision summary */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Why?</h3>
        <Field
          label="Thesis"
          hint={
            intent === 'open'
              ? 'Optional to save, but this is the thing you will want back in six months.'
              : 'Optional.'
          }
        >
          <textarea
            data-testid="thesis"
            className={`${inputClass} min-h-28`}
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            placeholder="What do you expect, and what would prove you wrong?"
          />
        </Field>

        {/* §D.1: creating an item must never require a review date or a
            notification. The default is no review planned (FR-070). */}
        <p className="rounded-lg bg-(--color-ink-muted)/8 px-3 py-2 text-xs text-(--color-ink-muted)">
          No review planned. You can add one later — reviews and notifications are entirely
          optional, and a review can be silent.
        </p>
      </section>

      {/* 5. Save */}
      <section>
        <button
          type="button"
          data-testid="save"
          disabled={quantityMissing || priceMissing}
          className="w-full rounded-xl bg-(--color-accent) px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Save
        </button>
        {quantityMissing || priceMissing ? (
          <p data-testid="required-hint" className="mt-2 text-center text-xs text-(--color-ink-muted)">
            {quantityMissing && priceMissing
              ? 'Quantity and entry price are required.'
              : quantityMissing
                ? 'Quantity is required — everything else is filled in.'
                : 'Entry price is required because no quote was available.'}
          </p>
        ) : (
          <p className="mt-2 text-center text-xs text-(--color-ink-muted)">
            Saving arrives in the next phase — this flow is complete up to the commit.
          </p>
        )}
      </section>
    </div>
  );
}
