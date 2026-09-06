import { isValidTimeZone } from '../../domain/time/format';
import type { ResolvedInstrument } from '../instruments/search';
import type { CreateItemCommand, NewLot } from '../ports/portfolio-repository';

/**
 * Validates and assembles a create-item command (§C.1, §C.2, FR-045).
 *
 * The whole quick-add saves in one request. §C.2 promises a one-tap save, and
 * an item that exists without the purchase it was created to record is worse
 * than a failure — so validation happens up front and the write is atomic.
 *
 * What is deliberately NOT required here: a review date, a notification
 * channel, or a thesis. §D.1 is explicit that creating an item must never
 * require any of them, and acceptance criterion 4 tests exactly that.
 */

export interface CreateItemInput {
  intent?: string;
  timezone?: string;
  /** For a resolved instrument. Mutually exclusive with `manual`. */
  instrumentRef?: string;
  /** §B.3 manual/custom asset, used when lookup fails or the asset is unlisted. */
  manual?: {
    symbol?: string;
    displayName?: string;
    assetType?: string;
    currency?: string;
    exchange?: string | null;
  };
  lot?: {
    quantity?: string;
    entryPrice?: string;
    fees?: string;
    boughtAt?: number;
    brokerName?: string | null;
    entryPriceSource?: string;
    quoteAsOf?: number | null;
  };
  thesis?: { body?: string; templateId?: string | null };
}

export type CreateItemFailure = { field: string; message: string };

export type CreateItemResult =
  | { ok: true; command: CreateItemCommand }
  | { ok: false; errors: CreateItemFailure[] };

/** Plain decimal, optionally signed. Rejects `1e5`, `NaN`, `1,5`, empty. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

function isPositive(value: string): boolean {
  return DECIMAL.test(value) && Number(value) > 0;
}

function isNonNegative(value: string): boolean {
  return DECIMAL.test(value) && Number(value) >= 0;
}

export function buildCreateItemCommand(
  userId: string,
  input: CreateItemInput,
  instrument: ResolvedInstrument | null,
  defaults: { timezone: string },
  now: number,
): CreateItemResult {
  const errors: CreateItemFailure[] = [];

  const hasRef = Boolean(input.instrumentRef);
  const hasManual = Boolean(input.manual);

  if (hasRef && hasManual) {
    errors.push({
      field: 'instrumentRef',
      message: 'Provide either instrumentRef or manual, not both.',
    });
  }
  if (!hasRef && !hasManual) {
    errors.push({ field: 'instrumentRef', message: 'instrumentRef or manual is required.' });
  }
  if (hasRef && !instrument) {
    errors.push({ field: 'instrumentRef', message: 'Unrecognised instrument reference.' });
  }

  const timezone = input.timezone ?? defaults.timezone;
  if (!isValidTimeZone(timezone)) {
    // Rejected rather than substituted: a reminder written against a zone the
    // scheduler cannot resolve fires at the wrong time with no error anywhere.
    errors.push({ field: 'timezone', message: `Unknown time zone: ${timezone}` });
  }

  const intent = input.intent === 'open' ? 'open' : 'watching';

  let symbol: string;
  let displayName: string;
  let assetType: string;
  let currency: string;
  let exchange: string | null;

  if (instrument) {
    symbol = instrument.symbol;
    displayName = instrument.displayName;
    assetType = instrument.assetType;
    currency = instrument.currency ?? '';
    exchange = instrument.exchange;

    if (!currency) {
      // §B.3: a resolvable instrument with unknown currency can still be
      // saved, but the user has to say what it trades in — we will not guess.
      errors.push({
        field: 'manual.currency',
        message: 'Currency is unknown for this instrument; supply it explicitly.',
      });
    }
  } else {
    const m = input.manual ?? {};
    symbol = (m.symbol ?? '').trim();
    displayName = (m.displayName ?? '').trim();
    assetType = (m.assetType ?? 'other').trim();
    currency = (m.currency ?? '').trim().toUpperCase();
    exchange = m.exchange ?? null;

    if (hasManual) {
      if (!symbol) errors.push({ field: 'manual.symbol', message: 'Symbol is required.' });
      if (!displayName) {
        errors.push({ field: 'manual.displayName', message: 'Name is required.' });
      }
      if (!/^[A-Z]{3}$/.test(currency)) {
        errors.push({
          field: 'manual.currency',
          message: 'Currency must be a 3-letter code.',
        });
      }
    }
  }

  let lot: NewLot | null = null;

  if (intent === 'open') {
    const raw = input.lot ?? {};
    const quantity = (raw.quantity ?? '').trim();
    const entryPrice = (raw.entryPrice ?? '').trim();
    const fees = (raw.fees ?? '0').trim() || '0';

    // §C.1: quantity is the one field the system genuinely cannot know.
    if (!isPositive(quantity)) {
      errors.push({ field: 'lot.quantity', message: 'Quantity must be a positive number.' });
    }
    if (!isNonNegative(entryPrice)) {
      errors.push({ field: 'lot.entryPrice', message: 'Entry price is required.' });
    }
    if (!isNonNegative(fees)) {
      errors.push({ field: 'lot.fees', message: 'Fees cannot be negative.' });
    }

    if (errors.length === 0) {
      lot = {
        boughtAt: raw.boughtAt ?? now,
        quantity,
        entryPrice,
        currency,
        fees,
        brokerName: raw.brokerName?.trim() || null,
        // Provenance (FR-043): distinguishes a prefilled quote from a
        // corrected broker fill, months after anyone remembers which it was.
        entryPriceSource: raw.entryPriceSource === 'latest_quote' ? 'latest_quote' : 'manual',
        entryPriceQuoteAsOf: raw.quoteAsOf ?? null,
      };
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const thesisBody = input.thesis?.body?.trim();

  return {
    ok: true,
    command: {
      item: {
        userId,
        instrument,
        symbol,
        displayName,
        assetType,
        exchange,
        currency,
        status: intent,
        timezone,
        createdAt: now,
      },
      lot,
      thesisBody: thesisBody ? thesisBody : null,
      thesisTemplateId: input.thesis?.templateId ?? null,
    },
  };
}
