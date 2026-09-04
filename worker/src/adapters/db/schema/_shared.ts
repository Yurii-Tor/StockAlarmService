import { integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Column conventions for this schema. See ADR-0001 for why each exists,
 * since D1 is SQLite and several of the addendum's Postgres assumptions
 * (text[], numeric, timestamptz, citext) have no direct equivalent.
 */

/**
 * An instant, stored as epoch milliseconds.
 *
 * Deliberately `number`, not Drizzle's `timestamp_ms` mode: that mode hands
 * back a JS `Date`, and `Date` cannot express a wall-clock time in a named
 * zone, which is the whole problem ADR-0003 exists to solve. Values convert
 * to `Temporal.Instant` at the adapter boundary and never travel as `Date`.
 */
export const instant = (name: string) => integer(name, { mode: 'number' });

/**
 * A wall-clock time of day, 'HH:MM'. Not an instant — quiet hours and
 * reminder times are local-time concepts (FR-078, FR-095).
 */
export const localTime = (name: string) => text(name);

/**
 * An exact decimal, stored as a string.
 *
 * Money and quantity must never round-trip through a JS `number`:
 * 0.1 + 0.2 !== 0.3, and a position's cost basis is not a place to discover
 * that. Arithmetic happens on a decimal type in the domain layer (FR-051).
 */
export const decimal = (name: string) => text(name);

/**
 * A JSON-encoded array of channel names, or NULL.
 *
 * The three states are NOT interchangeable and NULL must never be
 * normalised to '[]' — see ADR-0007. NULL inherits the account default,
 * '[]' is explicitly silent, and a populated array overrides.
 */
export const channelSelection = (name: string) => text(name);

/** UUIDv7 primary key: time-ordered, so index locality holds as rows grow. */
export const id = () => text('id').primaryKey();

/** Rows that record when they were written. */
export const timestamps = {
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
};

/**
 * An instant on a table owned by Better Auth.
 *
 * Better Auth's Drizzle adapter reads and writes JS `Date`, so its own tables
 * must map that way. This is confined to infrastructure and never reaches the
 * domain layer, where `Date` stays lint-banned (ADR-0003).
 *
 * The generated SQL is identical either way -- both are `integer` columns --
 * so this is purely a TypeScript mapping choice, not a schema difference.
 */
export const authInstant = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** `created_at` / `updated_at` for Better Auth-owned tables. */
export const authTimestamps = {
  createdAt: authInstant('created_at').notNull(),
  updatedAt: authInstant('updated_at').notNull(),
};

/** `CHECK (col IN (...))` for enum-ish text columns (ADR-0001). */
export const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/** `CHECK` that a nullable JSON column holds valid JSON when present. */
export const validJsonOrNull = (column: string) =>
  sql.raw(`${column} is null or json_valid(${column})`);
