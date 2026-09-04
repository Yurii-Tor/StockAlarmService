# Operations Runbook

## 1. Local development

No Docker and no .NET are required. Node 22+ and npm are sufficient.

```
npm install
npm run db:migrate:local      # apply D1 migrations to the local Miniflare DB
npm run dev                   # wrangler dev - API, cron, queues, static assets
npm test                      # vitest inside workerd, real D1/DO/Queue bindings
npm run lint                  # includes the layering + clock rules (FR-0A8, NFR-05)
```

`npm run dev` binds a **local** D1, KV, Queue and Durable Object. Nothing touches production.

To exercise cron locally without waiting: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`.

## 2. Environments

| Env | Purpose | Database |
|---|---|---|
| local | Miniflare, in `.wrangler/state` | ephemeral, disposable |
| production | **https://stockalarm.torproduction.com** | `stockalarm` |

Provisioned Cloudflare resources (account `e693626956842865123018153a6dbc31`):

| Resource | Name | Id |
|---|---|---|
| D1 | `stockalarm` | `54c947ff-3c1f-405d-bb81-dd8ecb6c261d` |
| KV | `CACHE` | `f2334d5b42a34c2faeb1887e085448f6` |
| Queue | `stockalarm-delivery` | — |
| Queue (DLQ) | `stockalarm-delivery-dlq` | — |
| Durable Object | `DispatcherDO` | SQLite-backed |

Deploy with `npm run deploy` (builds the web bundle, then `wrangler deploy`).
Apply schema changes to production with `npm run db:migrate:remote` **before**
deploying the code that depends on them.

### Sign-in is not yet deliverable in production

`GET /api/v1/health/ready` reports `auth.magicLink.delivers`. While that is
`false`, magic links are written to the Worker log instead of being emailed,
so **no one can sign in to production**. Two secrets close this:

```
npx wrangler secret put RESEND_API_KEY      # after verifying the sending domain
npx wrangler secret put GOOGLE_CLIENT_ID    # optional second route in
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Google OAuth is worth adding precisely because it does not depend on email
deliverability: if Resend has a bad day, magic-link sign-in stops entirely.

## 3. Secrets

Set with `npx wrangler secret put <NAME>`. **Never** commit any of these; `.dev.vars` is gitignored and is for local development only.

| Secret | Used by | Notes |
|---|---|---|
| `FINNHUB_API_KEY` | market-data adapter | Free tier, ~60 calls/min |
| `ONESIGNAL_APP_ID` | push adapter | Also needed by the frontend at build time (public) |
| `ONESIGNAL_REST_API_KEY` | push adapter | Sent as `Authorization: Key <value>` |
| `RESEND_API_KEY` | email adapter | |
| `BETTER_AUTH_SECRET` | sessions | 32+ random bytes |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth | |

## 4. Free-tier budget (NFR-06)

| Resource | Free limit | Our steady-state use | Guard |
|---|---|---|---|
| Worker requests | 100k/day | UI + API calls | Static assets are free and unlimited |
| **D1 row writes** | **100k/day** | occurrences, events, deliveries, inbox, user edits | Quote cache and provider-call counters live in **KV**, not D1 (ASM-028) |
| D1 row reads | 5M/day | dispatch scans, list views | Partial indexes on the hot paths |
| Queue operations | 10k/day | one message per delivery | Only notifying occurrences enqueue |
| KV writes | 1k/day | quote refreshes | Refresh only instruments with active targets |
| CPU | 10 ms/invocation | I/O wait does not count | Heavy work runs in cron and queue handlers |
| Cron triggers | 5 | 3 used | every-minute dispatch, 5-minute quotes, nightly sync |

If the D1 write budget is ever approached, the first thing to check is whether anything started writing quotes or provider logs into D1.

## 5. Scheduled jobs

| Schedule | Job | Purpose |
|---|---|---|
| `* * * * *` | dispatch tick | Materialize due occurrences, run the §H.1 algorithm, enqueue deliveries |
| `*/5 * * * *` | quote refresh | Only instruments with active price targets |
| `0 3 * * *` | nightly | Finnhub symbol-universe sync, retention pruning, overdue digest |

## 6. Time zone data (ADR-0003)

Reminder correctness depends on the runtime's tzdata. **A government rule change that the runtime has not picked up makes reminders fire an hour off, silently — no error is raised.**

- The resolved tzdata version is logged at startup and exposed on `GET /api/v1/health/ready`.
- **Review quarterly.** If the version is stale relative to the current IANA release, redeploy to pick up the runtime update.

## 7. Diagnosing a notification that did not arrive

Work down this list; each step is answerable from data the system already records (FR-0A2, FR-0B1).

1. `GET /api/v1/notification-diagnostics` — the single best starting point.
2. **Does a `review_occurrence` exist?** No: the plan is not due yet, or the scanner is not running.
3. Is its state `skipped_silent`? Then the effective channel set was empty — the reminder is silent by configuration (FR-072). Working as designed.
4. **Does a `notification_event` exist?** No, and the occurrence is not silent: the dispatcher failed. Check Worker logs.
5. **Check `notification_deliveries` for that event, per channel:**
   - `skipped` + `email_unverified` — the address is not verified (FR-086).
   - `skipped` + `no_push_subscription` — no active OneSignal subscription. On iOS this almost always means the user never added the app to the Home Screen (ADR-0005).
   - `failed` with `attempt_count < max_attempts` — still retrying; check `next_attempt_at`.
   - `expired` — exhausted retries; `provider_response` holds the last error.
   - `queued` with a future `next_attempt_at` — deferred by quiet hours (FR-096). Not lost.
6. **The in-app inbox always has the record** when `in_app` was selected (FR-087). If it does not, that is a real bug, not a delivery problem.

## 8. Known operational limits

- **Delivery is at-least-once** (FR-0A6). A crash between the provider call and the write can duplicate one external send. Bounded by the pre-incremented attempt counter.
- **Push on iOS is best-effort** (ADR-0005). Email and the in-app inbox are the reliable channels there.
- **Finnhub free tier** is roughly 60 calls/minute and does not include ISIN. Search is served from our own synced `instruments` table, so a provider outage degrades quotes only, not search.
- **D1 export excludes FTS5 virtual tables.** The account-export path reads base tables directly.
