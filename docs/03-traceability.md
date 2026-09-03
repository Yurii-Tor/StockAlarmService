# Traceability Matrix

Maps the addendum's twelve acceptance criteria (§I) to the requirements that implement them, the phase that delivers them, and the test that proves them.

**Rule:** a phase is not done until every criterion it claims has a *named, passing* test. Test names are stable and must not be renamed without updating this table.

## Acceptance criteria

| # | Criterion (§I) | Requirements | Phase | Proving test |
|---|---|---|---|---|
| 1 | `MSFT` search shows company name, NASDAQ, stock type, USD | FR-010–014, FR-021 | 2, 3 | `instrument-search.test.ts` → `search_msft_returns_disambiguated_listing`; e2e `ac-01-search-disambiguation` |
| 2 | Selection auto-fills symbol, name, exchange, currency, type, price, quote timestamp/freshness, creation time | FR-020–026 | 2, 3 | `draft-from-instrument.test.ts` → `returns_fully_prefilled_draft`; e2e `ac-02-prefill` |
| 3 | `I bought it` fills date=now, price=quote, fees=0, status=open; all editable | FR-041, FR-043 | 2, 3 | `draft-from-instrument.test.ts` → `buy_intent_prefills_lot_draft`; e2e `ac-03-buy-intent` |
| 4 | Item saves with no review date and no push | FR-045, FR-070 | 4 | e2e `ac-04-save-without-reminder` |
| 5 | Review date with no channels: visible in calendar, no external delivery | FR-072, FR-075, FR-077, FR-079 | 5 | `dispatch.test.ts` → `empty_channels_creates_no_event`; e2e `ac-05-silent-review` |
| 6 | Push only, Email only, In-app only, or any combination | FR-071, FR-080 | 7 | `channel-matrix.test.ts` → parameterized over all 7 non-empty subsets; e2e `ac-06-channel-combinations` |
| 7 | Separate global defaults per category; a reminder overrides them | FR-077, FR-082, FR-083 | 6 | `channel-resolver.test.ts` → `override_beats_default`, `defaults_are_per_category`; e2e `ac-07-defaults-and-override` |
| 8 | Email not selectable as active until verified | FR-086, FR-090, FR-091 | 6 | `email-verification-gate.test.ts` → `unverified_email_rejected_by_api`, `dispatcher_skips_unverified`; e2e `ac-08-email-verification-gate` |
| 9 | Push+Email creates one event, separate delivery records, independent failure | FR-0A1, FR-0A2, FR-0A3 | 5, 7 | `push-fails-email-delivers.test.ts` → `event_partially_delivered`; e2e `ac-09-independent-channels` |
| 10 | Push denied/failed: diagnostics identifies it; inbox retains the event | FR-085, FR-087, FR-0A5, FR-0B1 | 7 | `diagnostics.test.ts` → `push_skipped_surfaces_reason`; e2e `ac-10-diagnostics` |
| 11 | No channels: no external notification, still due/overdue in the UI | FR-072, FR-075, FR-079 | 5 | `occurrence-state.test.ts` → `silent_plan_becomes_overdue`; e2e `ac-11-no-channels-still-due` |
| 12 | All defaults, timezone, privacy and quiet hours editable in Settings | FR-044, FR-0B0 | 6 | `settings-round-trip.test.ts`; e2e `ac-12-settings-round-trip` |

## Requirements with no acceptance criterion

These are binding but not covered by §I, so they need their own tests or they will silently rot.

| Requirement | Phase | Test |
|---|---|---|
| FR-014 never auto-select an ambiguous symbol | 3 | `ticker-search.test.tsx` → `does_not_autoselect_when_symbol_ambiguous` |
| FR-023 / FR-026 never label stale data "current" | 3 | `freshness-badge.test.tsx` → `word_current_only_for_realtime` |
| FR-031 metadata retained when quote fails | 2 | `quote.test.ts` → `provider_timeout_returns_unavailable_with_metadata` |
| FR-033 / FR-066 non-monitorable assets cannot activate targets | 9 | `price-target.test.ts` → `non_monitorable_cannot_activate` |
| FR-045 quick-add saves atomically | 4 | `create-item.test.ts` → `partial_failure_rolls_back_everything` |
| FR-053 no cross-currency totals | 4 | `position-summary.test.ts` → `mixed_currency_items_are_not_summed` |
| FR-054 thesis is append-only | 4 | `thesis.test.ts` → `save_creates_version_never_updates` |
| FR-063 zero-channel target stored as passive | 9 | `price-target.test.ts` → `no_channels_stored_as_passive` |
| FR-078 / NFR-01 DST correctness | 5 | `review-schedule.test.ts` → full zone matrix (below) |
| FR-093 thesis text excluded from email | 7 | `email-template.test.ts` → `body_excludes_thesis_by_default` |
| FR-096 / FR-098 quiet hours defer, never discard | 8 | `quiet-hours.test.ts` → `event_persisted_inbox_immediate_push_deferred` |
| FR-099 inbox written at original time | 8 | `quiet-hours.test.ts` → `inbox_not_deferred` |
| FR-0A4 in-app is the durable fallback | 5 | `dispatch.test.ts` → `inbox_row_in_same_batch_as_event` |
| FR-0A6 at-least-once bounded by attempt counter | 8 | `retry.test.ts` → `attempt_increments_before_provider_call` |
| FR-0A8 domain does not import providers | 1 | `npm run lint` — ESLint `no-restricted-imports`; CI fails on violation |
| NFR-02 concurrent dispatch is idempotent | 5 | `dispatch.test.ts` → `concurrent_ticks_produce_exactly_one_event` |
| NFR-06 free-tier budget | 1 | `docs/04-operations.md` budget table; Workers Analytics alert |

## DST test matrix (FR-078, NFR-01)

`review-schedule.test.ts` must cover every row. These are the cases that break naive date arithmetic.

| Case | Zone | Why it is included |
|---|---|---|
| Spring forward, nonexistent local time | `Europe/Bucharest` | 03:00 does not exist on the transition date; resolution policy must be explicit |
| Fall back, ambiguous local time | `Europe/Bucharest` | 03:00 occurs twice; must pick deterministically |
| Standard northern DST | `America/New_York` | Different transition dates from Europe |
| **30-minute DST offset** | `Australia/Lord_Howe` | The case that breaks arithmetic assuming whole-hour offsets |
| Month-end clamping | any | Jan 31 + 1 month must give Feb 28/29, never Mar 3 |
| Quarterly across a transition | `Europe/Bucharest` | A 09:00 plan must stay 09:00 local, not drift to 08:00 |
| Zone with a historical rule change | any | Proves behaviour is tzdb-driven, not hardcoded |

## Phase completion checklist

| Phase | Criteria proven | Gate |
|---|---|---|
| 0 | — | Consolidated spec signed off; scaffold builds; `npm test` green |
| 1 | — | Migrations apply; authenticated `/me`; **live HTTPS URL exists**; lint fails on a deliberate domain-layer provider import |
| 2 | 1, 2, 3 (API) | No test touches a live provider |
| 3 | 1, 2, 3 (e2e) | Only quantity is required after choosing "I bought it" |
| 4 | 4 | Item saves with no reminder and no channels |
| 5 | 5, 11 (+ structural half of 9) | Two concurrent ticks produce exactly one event |
| 6 | 7, 8, 12 | Email gate enforced at API **and** UI |
| 7 | 6, 9, 10 | Push failure does not block email; a real iPhone receives a push |
| 8 | — (hardens 9, 10) | Quiet-hours event: inbox immediate, push deferred, nothing lost |
| 9 | — | Targets reuse the pipeline with zero pipeline changes |
| 10 | all 12 re-verified | CI green from a clean clone |
