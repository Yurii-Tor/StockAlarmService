/**
 * Types and Zod schemas shared by the Worker API and the web client,
 * so validation is defined once (ADR-0004).
 */

export const NOTIFICATION_CHANNELS = ['push', 'email', 'in_app'] as const;
export type NotificationChannelType = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Three-state channel selection. See ADR-0007 — these states are NOT
 * interchangeable and must never be normalised to one another:
 *
 *   null  -> inherit the account default for this category
 *   []    -> explicitly silent; never notify, regardless of defaults
 *   [...] -> explicit override of the account default
 */
export type ChannelSelection = readonly NotificationChannelType[] | null;

export const QUOTE_FRESHNESS = ['realtime', 'delayed', 'stale', 'unavailable'] as const;
export type QuoteFreshness = (typeof QUOTE_FRESHNESS)[number];
