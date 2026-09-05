/**
 * All time enters the system through this port.
 *
 * `Date.now()` and `new Date()` are lint-banned in domain/ and app/ (NFR-05).
 * Without that discipline the DST-sensitive scheduling work in Phase 5 cannot
 * be tested, because its behaviour would depend on when the test happened to
 * run rather than on an input.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch, UTC. */
  now(): number;
}

/** Test double. Advance it explicitly instead of sleeping. */
export class FixedClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current;
  }

  advanceBy(milliseconds: number): void {
    this.current += milliseconds;
  }

  set(milliseconds: number): void {
    this.current = milliseconds;
  }
}
