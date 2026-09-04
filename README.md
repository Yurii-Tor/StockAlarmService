# StockAlarmService

An investment thesis and review reminder service. You record *why* you bought or watched
something, and it brings that reasoning back to you on a schedule you chose — through the
channels you chose, or through none at all.

Not a broker. Not an advisor. A decision journal with a scheduler attached.

## Start here

| Document | What it is |
|---|---|
| **[docs/00-consolidated-spec.md](docs/00-consolidated-spec.md)** | **The single source of truth.** Read this first |
| [docs/01-addendum-source.md](docs/01-addendum-source.md) | The original addendum, verbatim. Never edited |
| [docs/02-assumptions.md](docs/02-assumptions.md) | Every inferred requirement and open question |
| [docs/03-traceability.md](docs/03-traceability.md) | Acceptance criteria to phase to proving test |
| [docs/04-operations.md](docs/04-operations.md) | Runbook, secrets, budgets, diagnosing a missing notification |
| [docs/adr/](docs/adr/) | Why the load-bearing decisions were made |

> **Note on provenance.** The project began as a single *addendum* — a delta against a base
> specification that was never delivered and does not exist. `00-consolidated-spec.md`
> reconstructs that base and merges the addendum into it. Requirements are tagged **[A]**
> (from the addendum), **[R]** (reconstructed) or **[D]** (deliberate deviation), so it is
> always visible which requirements are original and which are inferred.

## Stack

TypeScript on Cloudflare Workers · D1 (SQLite) + Drizzle · Durable Objects + Queues + Cron
· React 19 PWA · OneSignal Web Push · Resend · Finnhub.

Runs entirely within the Cloudflare free tier. No Docker, no .NET, no local database.

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars      # defaults to the fake market-data provider
npm run db:migrate:local
npm run dev
```

Then `npm test` (Vitest inside `workerd`, with real bindings) and `npm run lint`.

`npm run lint` is not cosmetic here: it enforces that the domain layer never imports a
provider (spec FR-0A8) and never reads an ambient clock (NFR-05). Both are CI gates.

## Two things worth knowing before you read the code

**A review plan is not a notification.** They are separate records with separate lifecycles.
A reminder can exist with a date, a recurrence, and no delivery at all — visible in the
calendar, silent everywhere else. The `channels` column is deliberately three-state:
`NULL` means inherit, `[]` means explicitly silent, and a non-empty array overrides.
Collapsing those states breaks three acceptance criteria at once. See
[ADR-0007](docs/adr/0007-channels-null-vs-empty.md).

**Push on iOS is best-effort.** Reaching an iPhone requires iOS 16.4+, HTTPS, and the user
adding the app to the Home Screen. Email and the in-app inbox are the reliable channels.
The spec anticipated this: the inbox records every event even when every external channel
fails. See [ADR-0005](docs/adr/0005-onesignal-web-push-replaces-apns.md).

## Status

**Phase 1 complete** — deployed at **https://stockalarm.torproduction.com**.

Full D1 schema (23 tables + FTS5), Drizzle, Hono, and magic-link + Google authentication.
Cron triggers, queues and the dispatcher Durable Object are bound but not yet implemented.

> **Sign-in does not deliver yet.** Magic links are written to the Worker log until a Resend
> API key is set — `GET /api/v1/health/ready` reports this as `auth.magicLink.delivers`.
> See OQ-12 in [docs/02-assumptions.md](docs/02-assumptions.md).

Build order and per-phase exit criteria are in [docs/03-traceability.md](docs/03-traceability.md).
