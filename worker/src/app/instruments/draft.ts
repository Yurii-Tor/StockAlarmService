import { exchangeNameForMic } from '../../domain/instruments/exchanges';
import { toIsoInZone } from '../../domain/time/format';
import type { StoredInstrument } from '../ports/instrument-repository';
import type { QuoteView } from './quotes';

/**
 * The prefilled quick-add draft (§G.2, §C.1, §C.2).
 *
 * This is where §A is honoured or lost: "the user should only need to enter
 * the information that cannot be known by the system". Everything derivable
 * from the instrument, the latest quote, the clock or user preferences is
 * filled here, so the only field left empty on a purchase is quantity.
 *
 * Nothing is persisted. The draft is a proposal the user edits and then
 * commits in one request (FR-045).
 */

export type Intent = 'watching' | 'open';

export interface UserDefaults {
  timezone: string;
  defaultNewItemStatus: string;
  prefillEntryPriceFromLatestQuote: boolean;
  lastUsedBrokerName: string | null;
  defaultBrokerName: string | null;
  defaultReviewPlanMode: string;
  defaultReviewChannels: readonly string[];
}

export interface InvestmentItemDraft {
  instrumentId: string;
  symbol: string;
  name: string;
  assetType: string;
  exchange: string | null;
  mic: string | null;
  currency: string | null;
  isin: string | null;
  figi: string | null;
  /** Local time in the user's zone, with offset (§B.2: creation time). */
  createdAt: string;
  timezone: string;
  status: Intent;
  /** §B.3: blocks target activation while leaving reminders usable. */
  isMonitorable: boolean;
}

export interface LotDraft {
  boughtAt: string;
  entryPrice: string | null;
  /** Provenance of `entryPrice`, so a later reader can tell quote from fill. */
  entryPriceSource: 'latest_quote' | 'manual';
  /** The quote's as-of time. Null when no usable quote existed. */
  quoteAsOf: string | null;
  currency: string | null;
  fees: string;
  /** Deliberately null: the one thing the system genuinely cannot know. */
  quantity: null;
  brokerName: string | null;
}

export interface DraftResponse {
  investmentItemDraft: InvestmentItemDraft;
  /** Present only for `I bought it`; `Watching` creates no lot (FR-042). */
  lotDraft: LotDraft | null;
  quote: QuoteView;
  defaultReviewPlan: { mode: string; channels: readonly string[] };
  /** Fields the user must supply before this draft can be saved. */
  requiredFields: readonly string[];
}

export interface BuildDraftInput {
  instrument: StoredInstrument;
  quote: QuoteView;
  intent: Intent;
  defaults: UserDefaults;
  now: number;
  timezone?: string;
  useLatestQuoteAsEntryPrice?: boolean;
}

export function buildDraft(input: BuildDraftInput): DraftResponse {
  const { instrument, quote, intent, defaults, now } = input;
  const timezone = input.timezone ?? defaults.timezone;
  const createdAt = toIsoInZone(now, timezone);

  const investmentItemDraft: InvestmentItemDraft = {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    name: instrument.displayName,
    assetType: instrument.assetType,
    exchange: instrument.exchange ?? exchangeNameForMic(instrument.mic),
    mic: instrument.mic,
    currency: instrument.currency,
    isin: instrument.isin,
    figi: instrument.figi,
    createdAt,
    timezone,
    status: intent,
    isMonitorable: instrument.isMonitorable,
  };

  if (intent !== 'open') {
    return {
      investmentItemDraft,
      lotDraft: null,
      quote,
      defaultReviewPlan: {
        mode: defaults.defaultReviewPlanMode,
        channels: defaults.defaultReviewChannels,
      },
      requiredFields: [],
    };
  }

  const wantsQuotePrefill =
    input.useLatestQuoteAsEntryPrice ?? defaults.prefillEntryPriceFromLatestQuote;

  /**
   * The entry price is prefilled from the quote only when a usable price
   * actually exists. Prefilling from an `unavailable` quote would put a
   * fabricated number into a purchase record, which is the one place in this
   * product where a wrong default is genuinely costly.
   */
  const canPrefill = wantsQuotePrefill && quote.price !== null;

  const lotDraft: LotDraft = {
    boughtAt: createdAt,
    entryPrice: canPrefill ? quote.price : null,
    entryPriceSource: canPrefill ? 'latest_quote' : 'manual',
    quoteAsOf: canPrefill ? quote.quoteAsOf : null,
    currency: instrument.currency,
    fees: '0',
    // §C.1: "Quantity defaults to empty and is required."
    quantity: null,
    brokerName: defaults.lastUsedBrokerName ?? defaults.defaultBrokerName,
  };

  return {
    investmentItemDraft,
    lotDraft,
    quote,
    defaultReviewPlan: {
      mode: defaults.defaultReviewPlanMode,
      channels: defaults.defaultReviewChannels,
    },
    // Quantity is always required; entry price joins it only when no quote
    // was available to prefill from.
    requiredFields: canPrefill ? ['quantity'] : ['quantity', 'entryPrice'],
  };
}
