# Assumptions and Open Questions

Every requirement tagged **[R]** or **[D]** in `00-consolidated-spec.md` traces to an entry here.

Status is one of: **Confirmed** (user decided), **Proposed** (default applied, reversible, needs review), **Open** (blocks work in a named phase).

## A. Confirmed decisions

| id | Assumption | Affects | Status |
|---|---|---|---|
| ASM-001 | **Authentication is magic link + Google OAuth.** The addendum never mentions auth in any section, yet presupposes users, accounts, per-user settings and a "verified account email address" (§E.3). Magic link doubles as the email-verification mechanism §E.3 already requires — one mechanism, two requirements. | Everything | Confirmed |
| ASM-002 | **Client is a web app / PWA, not native iOS.** §C.1, §D.2 and §E.2 describe phone screens; the development machine is Windows and Swift cannot be built or tested on it. | All UI | Confirmed |
| ASM-003 | **Storage is Cloudflare D1 (SQLite), not PostgreSQL.** §E.1 names PostgreSQL. Forced by the free-tier hosting decision. See ADR-0001 for every consequence. | Data model | Confirmed |
| ASM-004 | **Push is OneSignal Web Push, not APNs.** User instruction. §E.1 and §H.2 name APNs. | Push channel | Confirmed |
| ASM-005 | **Email is Resend.** §E.1 says "transactional email provider via a provider abstraction" without naming one. Workers cannot open SMTP sockets, so an HTTP API is required. | Email channel | Confirmed |
| ASM-006 | **Market data is Finnhub**, behind a provider port with a deterministic fake for tests. §B says "the configured market-data provider" without naming one. | Instruments | Confirmed |
| ASM-007 | **Single-user deployment, multi-user-capable schema.** Every table carries `user_id`; no row-level security, per-tenant quota or billing in MVP. | Data model | Confirmed |
| ASM-008 | **`INotificationChannel` is expressed in TypeScript.** §H.2 gives a C# signature but says "an interface *similar to*", so the shape is illustrative. The binding requirement — domain depends on the interface, not on a provider — is preserved and lint-enforced. | Notifications | Confirmed |

## B. Reconstructed base requirements (proposed)

These fill the hole left by the missing base specification. Each is inferred from something the addendum presupposes.

| id | Assumption | Inferred from | Status |
|---|---|---|---|
| ASM-010 | The product is a **decision journal with a scheduler**, not a trading, advisory or analytics tool. It never places orders and never advises. | The framing of §A and §C.3 | Proposed |
| ASM-011 | Item lifecycle is `watching` then `open` then `closed`, plus `archived`. | §C.2 names `watching` and `open` only | Proposed |
| ASM-012 | An item may hold **many lots**; `watching` items hold none. | §C.2 "No lot is created" for watching | Proposed |
| ASM-013 | Thesis is **append-only and versioned**; saving never overwrites. | §J.3 "thesis versioning"; §E.3 "read your original thesis" | Proposed |
| ASM-014 | **No cross-currency aggregation.** Totals are per-currency; no FX rates. | The addendum never mentions FX anywhere | Proposed — see OQ-7 |
| ASM-015 | Money and quantity are **exact decimals**, stored as strings, never binary floats. | Financial correctness | Proposed |
| ASM-016 | Item deletion is **soft**, preserving thesis and journal history until account purge. | §J.9 "export, deletion" | Proposed |
| ASM-017 | Price targets have kind and direction, with `crosses_*` requiring prior price history. | §D.3 and §J.8 assume targets exist without defining them | Proposed |
| ASM-018 | A triggered target **disarms and cools down** rather than re-alerting on every poll. | Usability; not stated | Proposed |
| ASM-019 | Quick-add **saves in a single request** (item + lot + thesis + plan + targets, atomically). | §C.2's "one-tap" promise dies with five round trips | Proposed |

## C. Design decisions that carry real risk if wrong

| id | Decision | Why it matters | Status |
|---|---|---|---|
| ASM-020 | **Channels have three states**: unset (inherit), empty (explicitly silent), non-empty (override). Stored as nullable JSON, `NULL` distinct from `[]`. | Collapsing unset and empty makes FR-072 and criterion 7 mutually unsatisfiable. A DTO typed as non-nullable `string[]` silently destroys it. See ADR-0007 | Proposed — **confirm** |
| ASM-021 | **Channel eligibility is evaluated per delivery row, not during resolution.** Ineligible channels produce `skipped` rows with reasons, never silent removal. | Criterion 10 requires diagnostics to *identify the issue*. A channel removed before the event is written leaves no evidence anywhere | Proposed — **confirm** |
| ASM-022 | **Every occurrence is materialized**, including silent ones. | Criteria 5 and 11 must point at something, and in both cases no notification event exists | Proposed |
| ASM-023 | **`overdue` is derived in queries, never stored.** | Removes a sweeper job and the class of bug where the sweeper was down so nothing showed overdue | Proposed |
| ASM-024 | **Recurrence is a closed preset set**, serialized to an RRULE-compatible string, not a full RFC 5545 engine. | §C.2's preset list is closed. Full RRULE is a large correctness surface for no gain, and the string format keeps the upgrade path open | Proposed |
| ASM-025 | Reminders store **wall-clock local time plus IANA zone**, not only a UTC instant. | Otherwise a 09:00 reminder set in September fires at 08:00 in December | Proposed |
| ASM-026 | Zero-channel price targets are stored as **passive, clearly marked**, behind a confirmation. | §D.3 explicitly permits either this or forcing in-app. One had to be chosen | Proposed — **confirm** |
| ASM-027 | The effective-delivery explanation (§E.2) is computed **server-side** via a preview endpoint. | Two implementations of the resolution rules will drift, and the one the user reads would not be the one that runs | Proposed |
| ASM-028 | Quote caching and provider-call accounting live in **KV, not D1**. | Protects the 100k/day D1 row-write budget. Only genuine domain events consume it | Proposed |
| ASM-029 | Delivery is **at-least-once**, bounded by a pre-incremented attempt counter. Exactly-once is not attempted. | Honesty about a real limit; documented rather than hidden | Proposed |

## D. Open questions

Answer before the phase named in *Blocks*. Recommended defaults apply if unanswered.

| id | Question | Recommended default | Blocks |
|---|---|---|---|
| OQ-1 | **Sign in with Apple requires an Apple Developer account ($99/yr).** Do you already have one? | Ship magic link + Google; add Apple only if the account exists | Phase 1 |
| OQ-2 | A **custom domain** is effectively required: Resend needs DKIM to avoid spam folders, and iOS PWA install is nicer on a real name (about $10/yr at Cloudflare Registrar, sold at cost). The alternative is `*.workers.dev` plus Resend's test sender, which only delivers to your own verified address. | Register a domain during Phase 1 | Phase 1 (email), Phase 7 (push) |
| OQ-3 | **Catch-up after downtime** — if the worker is down three days, do three days of daily reminders all fire at once? | Nothing older than 24h dispatches; older occurrences are created and shown overdue, but silent | Phase 8 |
| OQ-4 | May a user track the **same instrument in two separate items** (two strategies)? | Allow it; warn in the UI; no unique constraint | Phase 4 |
| OQ-5 | Should an inbox row be created for events where `in_app` was **not** selected? §E.2 says the inbox must record events when external channels fail; criterion 10 qualifies this with "when that channel was selected". | Inbox rows only when `in_app` is selected; diagnostics shows all events regardless | Phase 5 |
| OQ-6 | What exactly makes an alert **"critical"** (§E.4)? Per-reminder flag or per-category? | Per-reminder boolean, off by default | Phase 8 |
| OQ-7 | **Multi-currency totals.** Confirm per-currency-only is acceptable, or FX comes into scope. | Per-currency only; no FX | Phase 4 |
| OQ-8 | **Overdue email digest scope** — all overdue items, or only those with email enabled? | All overdue; the digest is a single opt-in email | Phase 8 |
| OQ-9 | **Quote history retention** for crossing detection. | 90 days | Phase 9 |
| OQ-10 | **Price-target polling cadence**, given the provider budget. | Every 5 min during market hours, for instruments with active targets only | Phase 9 |

## E. Facts verified during planning (not assumptions)

Recorded so they are not re-litigated.

- **Finnhub `/search` is insufficient on its own.** It returns symbol, description, displaySymbol and type — no exchange, MIC or currency — so it cannot satisfy criterion 1 or §B.1 disambiguation. **`/stock/symbol?exchange=US` returns `mic`, `currency`, `figi` and `isin`** (ISIN entitlement-gated). Therefore the nightly symbol-universe sync into our own `instruments` table plus FTS5 is the **primary** search path, not a fallback. Re-verify field availability with a live key in Phase 2 before building on it.
- **Cloudflare Containers is paid-only** ($5/mo Workers Paid plan), so .NET cannot run on Cloudflare for free. Workers execute JS/TS/Rust/Python only.
- **Cloudflare free tier**: 100k requests/day; D1 5 GB with 5M row reads and 100k row writes per day; Durable Objects SQLite-backed, with alarms; Queues 10k ops/day with 24h retention; KV 100k reads and 1k writes per day; static asset requests free and unlimited; cron triggers included; 10 ms CPU per invocation, where I/O wait does not count.
- **D1 supports SQLite FTS5**, including `fts5vocab`. D1 export does not support virtual tables, so export reads base tables directly.
- **OneSignal send API**: `POST https://api.onesignal.com/notifications`, header `Authorization: Key <REST_API_KEY>`, exactly one targeting method per request, `include_aliases.external_id` to reach a specific user. A 200 response **without** an `id` means no valid subscriptions — a skip, not a retryable failure.
- **OneSignal iOS web push** requires iOS/iPadOS 16.4+, HTTPS, a manifest with `display: standalone`, the OneSignal service worker, and the user must **Add to Home Screen and launch from there** before any permission prompt is possible. A denial is recoverable only by removing and re-adding the home-screen app. The App Store app named "OneSignal Push Notification" is a *sender* utility for developers and cannot receive our notifications.
- **Local toolchain**: Node v22.18.0, npm 11.5.2, git 2.45.1 — all sufficient. Docker and .NET are **not** required by this stack.
