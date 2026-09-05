import type { Clock } from '../../domain/time/clock';

/**
 * The only place ambient time enters the system.
 *
 * `Date.now()` is lint-banned everywhere except adapters, so this file is the
 * single seam where real time is read (NFR-05, ADR-0003).
 */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
