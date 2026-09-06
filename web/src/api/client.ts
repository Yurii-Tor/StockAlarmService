import type {
  CreateItemBody,
  DraftResponse,
  FieldError,
  ItemDetail,
  ItemSummary,
  Me,
  Quote,
  SearchResponse,
} from './types';

/**
 * API client.
 *
 * Same-origin with `credentials: 'include'`, because the session is an
 * HttpOnly cookie the page cannot read (ADR-0004, NFR-08). There is no token
 * to attach and none to leak.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    detail?: string,
    /** Present on 422: per-field validation failures. */
    readonly errors: FieldError[] = [],
  ) {
    super(detail ?? title);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { title?: string; detail?: string; errors?: FieldError[] }
      | null;
    throw new ApiError(
      response.status,
      body?.title ?? response.statusText,
      body?.detail,
      body?.errors ?? [],
    );
  }

  return (await response.json()) as T;
}

export const api = {
  me: () => request<Me>('/me'),

  signInWithMagicLink: (email: string) =>
    request<{ status: boolean }>('/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: '/' }),
    }),

  signOut: () => request<unknown>('/auth/sign-out', { method: 'POST' }),

  searchInstruments: (query: string, signal?: AbortSignal) =>
    request<SearchResponse>(`/instruments/search?q=${encodeURIComponent(query)}`, { signal }),

  quote: (instrumentRef: string, refresh = false) =>
    request<Quote>(
      `/instruments/${encodeURIComponent(instrumentRef)}/quote${refresh ? '?refresh=true' : ''}`,
    ),

  draftFromInstrument: (body: {
    instrumentRef: string;
    intent: 'watching' | 'open';
    useLatestQuoteAsEntryPrice?: boolean;
    timezone?: string;
  }) =>
    request<DraftResponse>('/investment-items/draft-from-instrument', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  createItem: (body: CreateItemBody) =>
    request<ItemDetail>('/investment-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  listItems: () => request<{ items: ItemSummary[] }>('/investment-items'),

  getItem: (id: string) => request<ItemDetail>(`/investment-items/${id}`),

  deleteItem: (id: string) =>
    request<null>(`/investment-items/${id}`, { method: 'DELETE' }),

  thesisVersions: (id: string) =>
    request<{
      versions: Array<{
        versionNo: number;
        body: string;
        changeSummary: string | null;
        createdAt: number;
      }>;
    }>(`/investment-items/${id}/thesis/versions`),

  saveThesis: (id: string, body: string, changeSummary?: string) =>
    request<{ versionNo: number }>(`/investment-items/${id}/thesis`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, changeSummary: changeSummary ?? null }),
    }),
};

/** Google sign-in is a full-page redirect, not a fetch. */
export function googleSignInUrl(): string {
  return `/api/v1/auth/sign-in/social?provider=google`;
}
