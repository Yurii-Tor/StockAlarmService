import { Temporal } from '@js-temporal/polyfill';

/**
 * Instant formatting for domain and application code.
 *
 * `new Date()` is lint-banned outside adapters (NFR-05), and rightly so: this
 * project's correctness depends on wall-clock times in named zones, which
 * `Date` cannot represent. Temporal is the tool ADR-0003 commits to, so it is
 * used here too rather than carving out an exception for formatting.
 */

/** Epoch milliseconds to an ISO-8601 UTC string. */
export function toIsoInstant(epochMillis: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMillis).toString();
}

/** Epoch milliseconds to ISO-8601 in a named IANA zone, with its offset. */
export function toIsoInZone(epochMillis: number, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMillis)
    .toZonedDateTimeISO(timeZone)
    .toString({ timeZoneName: 'never' });
}

/**
 * Validates an IANA zone id against the runtime's tzdb.
 *
 * `Temporal.TimeZone` was dropped from the specification, so validation goes
 * through an actual conversion: an unknown zone throws there, and a zone that
 * converts is a zone the scheduler can also use.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}
