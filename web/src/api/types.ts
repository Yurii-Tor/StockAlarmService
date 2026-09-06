/** Response shapes from the Worker API. Mirrors worker/src/app types. */

export type QuoteFreshness = 'realtime' | 'delayed' | 'stale' | 'unavailable';

export interface SearchResult {
  /** `provider:symbol`. No stored row exists until the user saves. */
  instrumentRef: string;
  symbol: string;
  displayName: string;
  assetType: string;
  exchange: string | null;
  mic: string | null;
  currency: string | null;
  isin: string | null;
  figi: string | null;
  isMonitorable: boolean;
  /** False when the directory has no venue/currency for this symbol. */
  metadataKnown: boolean;
  disambiguationLabel: string;
  isAmbiguousSymbol: boolean;
  primaryLine: string;
  secondaryLine: string;
}

export interface SearchResponse {
  results: SearchResult[];
  requiresDisambiguation: boolean;
}

export interface Quote {
  instrumentRef: string;
  price: string | null;
  currency: string | null;
  quoteAsOf: string | null;
  retrievedAt: string;
  delayMinutes: number;
  freshness: QuoteFreshness;
  ageSeconds: number | null;
  /** The server's verdict on whether the word "current" may be used (§B.2). */
  mayBeCalledCurrent: boolean;
  freshnessLabel: string;
  source: string;
  previousClose: string | null;
  dayOpen: string | null;
  dayHigh: string | null;
  dayLow: string | null;
  cached: boolean;
}

export interface InvestmentItemDraft {
  instrumentRef: string;
  symbol: string;
  name: string;
  assetType: string;
  exchange: string | null;
  mic: string | null;
  currency: string | null;
  isin: string | null;
  figi: string | null;
  createdAt: string;
  timezone: string;
  status: 'watching' | 'open';
  isMonitorable: boolean;
}

export interface LotDraft {
  boughtAt: string;
  entryPrice: string | null;
  entryPriceSource: 'latest_quote' | 'manual';
  quoteAsOf: string | null;
  currency: string | null;
  fees: string;
  quantity: null;
  brokerName: string | null;
}

export interface DraftResponse {
  investmentItemDraft: InvestmentItemDraft;
  lotDraft: LotDraft | null;
  quote: Quote;
  defaultReviewPlan: { mode: string; channels: string[] };
  requiredFields: string[];
}

export interface Me {
  user: { id: string; email: string; name: string | null };
  settings: {
    defaultTimezone: string;
    defaultNewItemStatus: string;
    defaultReviewChannels: string[];
    defaultPriceAlertChannels: string[];
    defaultPreReviewChannels: string[];
    prefillEntryPriceFromLatestQuote: boolean;
    lockScreenPrivacy: string;
    quietHours: {
      enabled: boolean;
      startLocalTime: string | null;
      endLocalTime: string | null;
      applyToEmail: boolean;
    };
    overdueDigestMode: string;
  } | null;
}
