# ADR-0003: Temporal for all date arithmetic, and an explicit DST policy

**Status:** Accepted · **Date:** 2026-09-03 · **Relates to:** FR-078, NFR-01, ASM-025

## Context

The product's core behaviour is firing a reminder at a time the user chose, possibly years later, possibly recurring. Two failure modes are silent and therefore dangerous:

1. **Drift across DST.** Storing only a UTC instant and adding one month means a 09:00 `Europe/Bucharest` reminder set in September fires at 08:00 in December. Nothing errors; the user just gets it at the wrong time.
2. **Unhandled transition edges.** A recurrence landing on a spring-forward gap targets a local time that does not exist. Landing on a fall-back overlap targets one that occurs twice.

JavaScript's `Date` cannot express any of this. It has no notion of a wall-clock time in a named zone.

## Decision

Use **`@js-temporal/polyfill`** (`Temporal.ZonedDateTime`, `PlainDate`, `PlainTime`) for every date computation in the domain layer.

Store on each reminder:

- `scheduled_for` — the anchor instant;
- `local_time_of_day` — **the wall-clock time the user meant**;
- `timezone` — IANA id, validated against tzdb on write.

Advance recurrence on the **local date**, then re-resolve to an instant:

```
nextLocalDate = anchorLocalDate.add({ months: n }, { overflow: 'constrain' })
zoned         = nextLocalDate.toZonedDateTime({
                  timeZone: tz,
                  plainTime: localTimeOfDay,
                }, { disambiguation: 'compatible' })
```

**Policy, stated once and tested:**

- `overflow: 'constrain'` — Jan 31 + 1 month is Feb 28/29, never Mar 3.
- `disambiguation: 'compatible'` — a nonexistent local time shifts **forward** by the gap; an ambiguous one takes the **earlier** instant.

## Consequences

- Both DST edges are an explicit, documented, tested choice rather than an accident of arithmetic.
- The test matrix in `03-traceability.md` is mandatory, and includes `Australia/Lord_Howe` specifically because its 30-minute DST offset breaks code that assumes whole-hour transitions.
- All time enters the domain through an injected `Clock` port; `Date.now()` is lint-banned outside adapters. Tests advance a fake clock instead of sleeping.
- The polyfill resolves zones through the runtime's ICU tzdata. **A government time-zone rule change the runtime has not picked up makes reminders fire an hour off with no error.** Mitigation: log the resolved tzdata version at startup, expose it on the health endpoint, review quarterly (see `04-operations.md`).
- If `Temporal` ships natively in `workerd`, the polyfill import is swapped for the global with no call-site changes.
