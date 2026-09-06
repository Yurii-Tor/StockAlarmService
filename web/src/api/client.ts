import type { DraftResponse, Me, Quote, SearchResponse } from './types';

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
      | { title?: string; detail?: string }
      | null;
    throw new ApiError(
      response.status,
      body?.title ?? response.statusText,
      body?.detail,
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
};

/** Google sign-in is a full-page redirect, not a fetch. */
export function googleSignInUrl(): string {
  return `/api/v1/auth/sign-in/social?provider=google`;
}
