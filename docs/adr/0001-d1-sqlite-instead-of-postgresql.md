# ADR-0001: D1 (SQLite) instead of PostgreSQL

**Status:** Accepted · **Date:** 2026-09-03 · **Relates to:** ASM-003, spec §E.1, §F.4

## Context

The addendum §E.1 specifies "PostgreSQL-backed notification/event records", and §F.3/§F.4 assume Postgres features: `text[]` array columns, and the concurrency idioms that normally back a job queue.

The hosting decision (free tier, Cloudflare) removes Postgres from the table. Cloudflare Workers cannot reach a Postgres instance for free in any always-on configuration: Hyperdrive fronts an external database that still has to exist, Neon's free tier is 0.5 GB with 100 CU-hours/month and would be kept awake by a per-minute cron, and Supabase free pauses after 7 days idle. D1 has no compute-hour meter at all.

## Decision

Use **Cloudflare D1** (SQLite) as the sole datastore.

## Consequences

| Postgres feature the spec assumes | D1 replacement |
|---|---|
| `text[]` channel arrays | `TEXT` holding JSON, `CHECK (json_valid(col))`. `NULL` stays distinct from `'[]'` — see ADR-0007 |
| `interval[]` pre-alert offsets | JSON array of ISO-8601 duration strings |
| `SELECT ... FOR UPDATE SKIP LOCKED` | A single Durable Object (`DispatcherDO`) serializes claiming. Unique indexes remain the correctness backstop |
| `citext` | `COLLATE NOCASE` |
| `pg_trgm` fuzzy search | **FTS5** virtual table (D1 supports FTS5 including `fts5vocab`) |
| `numeric(20,8)` | `TEXT` decimal strings. Never JS `number` — it cannot represent money exactly |
| `timestamptz` | `INTEGER` epoch milliseconds, UTC |
| Postgres `ENUM` | `TEXT` + `CHECK` (also the better choice on Postgres: enum values cannot be removed or reordered) |
| Advisory locks | Durable Object identity |

Accepted costs:

- **Write budget.** 100k D1 row-writes/day on the free plan. Mitigated by ASM-028: quote cache and provider-call accounting live in KV, so only genuine domain events consume the budget.
- **No true multi-statement transactions across HTTP.** `db.batch()` is atomic and is sufficient for the one place it matters — creating the notification event, the inbox row and the occurrence state change together (FR-0A0 steps 4–5).
- **Export excludes virtual tables.** D1 export does not support FTS5 tables; the export path reads base tables directly.

## Alternatives rejected

- **Cloudflare Containers + Postgres** — $5/mo, no free tier. Viable if the budget changes; nothing in the domain layer would need to move.
- **Neon via Hyperdrive** — keeps real Postgres, but a per-minute cron defeats scale-to-zero and would exhaust 100 CU-hours/month.
- **Durable Object storage as the primary store** — strong consistency per object, but no cross-user queries, which the calendar and diagnostics screens need.
