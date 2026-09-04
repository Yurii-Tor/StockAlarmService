# Investment Thesis & Review Reminder — Consolidated Specification

**Status:** Draft for sign-off · **Version:** 3.0 (reconstructed base + addendum v2 merged)
**Supersedes:** the missing original specification, plus `01-addendum-source.md`

---

## 0. About this document

### 0.1 Why it exists

The project was delivered as a single file: an **addendum** opening with *"Apply the following changes to the original Investment Thesis & Review Reminder App technical specification."* The document it amends was never delivered and does not exist on this machine — an exhaustive search of all Markdown and text files under Documents, Downloads, Desktop, OneDrive, AppData and the Recycle Bin, plus Codex and Claude session history, found the strings `Investment Thesis`, `InvestmentItems` and `ReviewReminders` in that one file and nowhere else.

A delta document cannot be implemented on its own. This specification therefore **reconstructs** the base requirements from what the addendum necessarily implies, and merges the addendum into them, producing one authoritative document.

### 0.2 How to read it

Every requirement carries a provenance tag:

| Tag | Meaning | Authority |
|---|---|---|
| **[A §x]** | Stated in the addendum, section x | Binding. Verbatim intent preserved |
| **[R]** | **Reconstructed** — inferred from what the addendum presupposes | Binding once signed off, but *inferred*. See `02-assumptions.md` |
| **[D]** | **Deviation** from the addendum's letter, with a stated reason | Requires explicit sign-off |

Requirement ids are stable (`FR-xxx`, `NFR-xx`) and are referenced by `03-traceability.md` and by test names.

The addendum's own text is preserved verbatim and unedited in `01-addendum-source.md`. Where this document and the addendum disagree, **this document wins only for entries tagged [D]**; everywhere else the addendum is the authority and any conflict is a defect in this document.

### 0.3 Signed-off decisions that shape the whole build

| # | Decision | Consequence |
|---|---|---|
| 1 | Client is a **web app / PWA**, not a native iOS app | [D] §C.1, §D.2 and §E.2 describe iOS screens; they become web screens. Every §I criterion stays demonstrable |
| 2 | Hosting is **Cloudflare Workers free tier** | [D] §E.1's "PostgreSQL-backed" becomes D1 (SQLite). See ADR-0001 |
| 3 | Push is **OneSignal Web Push**, not APNs | [D] §E.1. See ADR-0005 and §7.4 for what this costs on iOS |
| 4 | Email is **Resend** (HTTP API) | Workers cannot open SMTP sockets |
| 5 | Market data is **Finnhub** behind a provider port | [A §B] requires a "configured market-data provider" — the port is the requirement, Finnhub is the first adapter |
| 6 | Auth is **magic link + Google** | [R] The addendum never mentions authentication at all. Largest single reconstruction gap — ASM-001 |
| 7 | Personal use, multi-user-capable schema | Every table carries `user_id`; no row-level security in MVP |

---

## 1. Product definition

### 1.1 Purpose [R]

The product exists to solve one problem: **people buy or watch an asset for a reason, then forget the reason.** Months later they hold a position and cannot remember what they expected, what would have invalidated the idea, or when they last checked.

It is therefore a **decision journal with a scheduler attached** — not a trading app, not a broker integration, not a portfolio analytics product. Its core artefact is the *thesis*, and its core behaviour is bringing that thesis back in front of the user at a moment they chose in advance.

### 1.2 What it explicitly is not [R]

- Not a broker. It never places orders and never connects to a brokerage account.
- Not an advisor. It renders no opinion on any asset and produces no recommendations.
- Not a real-time trading terminal. Quotes may be delayed, and the product says so plainly (§3.3).
- Not a tax or accounting system. Lots exist to record what the user did, not to compute tax liability.

### 1.3 Primary user [R]

A self-directed retail investor holding a small number of positions (order of 10–100) over months to years, who wants discipline rather than speed.

### 1.4 Governing principle [A §A]

**Minimize manual entry.** When the user enters or selects a ticker, the system automatically resolves the asset and prefills every field obtainable from market data, the device, the user profile, or deterministic defaults.

The user should only supply what the system cannot know:

- whether they actually bought the asset or are only watching it;
- quantity, actual execution price, and fees, if recording a real purchase;
- their investment thesis, risks, and personal decision context;
- any non-default target prices or review plan.

**The system must never require manual entry of** date/time, currency, company name, asset type, exchange, or current quote when that data is available automatically. [A §A]

### 1.5 Second governing principle [A §D.1]

**Time-based reminders are entirely optional, and a plan is not a notification.**

Creating an asset, watchlist item, lot, thesis, target price, or price alert must never require a review deadline or a push notification. The system distinguishes:

- a **review plan record** — a planned date or recurrence kept in the app;
- a **notification delivery** — whether and where the user wants to be told.

All six of these must be possible [A §D.1]:

1. no review date and no reminder;
2. a review date visible only in the app, with no external notification;
3. a review date with push;
4. a review date with email;
5. a review date with both;
6. a review date with a repeated schedule but notifications turned off.

### 1.6 Third governing principle [A §B.2, §B.3]

**Never present data as more current or more certain than it is.** The system must never label stale or unavailable data as "current". Quote freshness, provider delay, and provenance are first-class, displayed in the UI and carried into notification bodies.

---

## 2. Domain model (conceptual)

```
User --1:1-- UserSettings
  |
  +--*-- NotificationEmailAddress (0..1 active)
  +--*-- PushSubscription
  +--*-- ThesisTemplate
  +--*-- InboxItem
  |
  +--*-- InvestmentItem --0..1-- Instrument   (null => manual asset)
            |
            +--*--- Lot                      (only when the user actually bought)
            +--0:1- Thesis --*-- ThesisVersion   (append-only)
            +--*--- JournalEntry
            +--*--- PriceTarget
            +--*--- ReviewReminder --*-- ReviewOccurrence
                                             |
                                             +--0:1-- NotificationEvent --*-- NotificationDelivery
```

**Terms** [R unless tagged]:

| Term | Definition |
|---|---|
| **Instrument** | A specific *listing* of a tradable asset on a specific venue, as resolved from a market-data provider. `MSFT` on NASDAQ and `MSFT` on a European venue are two Instruments [A §B.1] |
| **InvestmentItem** | The user's record about an asset — watched or held. References an Instrument, or none for a manual asset [A §B.3] |
| **Lot** | One purchase event: quantity, execution price, fees, date. An item may have many. `Watching` items have none [A §C.2] |
| **Thesis** | The user's reasoning, versioned. Never overwritten |
| **PriceTarget** | A threshold that, when crossed, may notify [A §D.3] |
| **ReviewReminder** | A *plan*: when to revisit, how often, and — separately — through which channels, if any [A §D.1, §F.3] |
| **ReviewOccurrence** | One materialized instance of a plan. Exists whether or not it notifies — this is what makes silent plans visible |
| **NotificationEvent** | Exactly one per notifying occurrence, deduplicated by key [A §F.4] |
| **NotificationDelivery** | One attempt-track per channel per event [A §F.4] |
| **Channel** | `push`, `email` or `in_app` in MVP, extensible [A §E.1] |

---

## 3. Functional requirements — assets and market data

### 3.1 Instrument search [A §B.1]

**FR-010** The "Add Investment Item" flow begins with a **single ticker/name search input**. Not a form. Not an asset-type picker first.

**FR-011** As the user types, the system queries a server-side symbol-search endpoint backed by the configured market-data provider.

**FR-012** Each search result must carry, where available: symbol, asset/company/fund name, asset type, exchange/MIC or market name, listing currency, country/region, an instrument identifier (ISIN, FIGI, or provider id), and **a distinguishable label for duplicate ticker symbols**.

**FR-013** Results render in this shape:

```text
MSFT — Microsoft Corporation
NASDAQ · Stock · USD
```

**FR-014** If multiple listings share a symbol, the user **must** choose the specific listing. The system must **never** automatically assume a ticker is unique across all exchanges. This is a code-level guard, not a UI convention.

### 3.2 Instrument resolution and prefill [A §B.2]

**FR-020** Immediately on selection, the system calls an asset-details/quote endpoint and prefills the draft item.

**FR-021** Auto-population and editability, exactly as specified:

| Field | Source | User can edit? |
|---|---|---|
| Symbol | Selected market instrument | Normally no; change by selecting another instrument |
| Display name | Provider instrument metadata | Yes |
| Asset type | Provider metadata | Yes, for manual correction |
| Exchange/market | Provider metadata | Only by choosing another listing |
| Currency | Provider metadata | Yes, if the item is custom/manual |
| Provider instrument ID | Provider metadata | No UI editing |
| ISIN/FIGI/other ID | Provider metadata where available | Read-only |
| Current/last price | Latest quote | No manual edit; refreshable |
| Quote timestamp | Latest quote | Read-only |
| Quote freshness/status | Computed from quote timestamp | Read-only |
| Created date/time | Current device/account time | Yes |
| Default timezone | Account default or device timezone | Yes |
| Default asset status | User preference, default `watching` | Yes |
| Default review plan | User preference, default disabled | Yes |
| Default notification channels | User notification preferences | Yes, per reminder/alert |

**FR-022** Provenance and freshness display clearly, e.g.:

```text
Last price: $480.15
NASDAQ · USD · quote delayed 15 min · as of 2026-09-03 12:35 EEST
```

**FR-023** The system **must never** label stale or unavailable data as "current".

### 3.3 Quote freshness model [R, implementing A §B.2/§B.3]

**FR-024** Every quote carries **two distinct timestamps**: `quoteAsOf` (the provider's own as-of time) and `retrievedAt` (when we fetched it). Cache TTL is computed from `retrievedAt`; display uses `quoteAsOf`. Conflating them is how stale data gets labelled "current".

**FR-025** Freshness is one of exactly four states:

| State | Meaning | UI |
|---|---|---|
| `realtime` | Provider reports no delay, within TTL | May be called "current" |
| `delayed` | Provider supplies delayed data | Delay shown, e.g. "delayed 15 min" |
| `stale` | Past TTL, refresh failed or not attempted | Age shown; never "current" |
| `unavailable` | No usable quote | `Price unavailable` + Retry |

**FR-026** The word "current" is reserved for `realtime`. Enforced by test.

### 3.4 Draft states and failure handling [A §B.3]

**FR-030** The user may save a **manual/custom asset** if lookup fails.

**FR-031** If metadata resolves but the quote fails, the system retains instrument metadata and shows `Price unavailable` with a retry action.

**FR-032** If the provider supplies only delayed quotes, the delay/freshness state appears in the UI **and in relevant alert details**.

**FR-033** Target monitoring must be **prevented** for assets that cannot be mapped to a monitorable provider instrument. Reminders and journal fields remain fully available for such assets.

**FR-034** Asset metadata and quote results are cached to reduce external calls, subject to provider licensing and freshness requirements.

---

## 4. Functional requirements — quick-add flow

### 4.1 Layout [A §C.1]

**FR-040** After choosing an instrument, show a **compact prefilled form**, not a long blank one:

1. **Selected asset card** — symbol, name, exchange, asset type, currency, latest price, quote timestamp.
2. **Intent selector** — `Watching` (default) / `I bought it`.
3. **Purchase section**, shown only for `I bought it`:
   - buy date/time defaults to now;
   - purchase price defaults to latest quote;
   - currency defaults to instrument currency;
   - **quantity defaults to empty and is required**;
   - fees default to 0;
   - **all fields editable**, because actual broker execution can differ from a market quote.
4. **Decision summary** — thesis (optional to save, strongly prompted for open positions); base target price (optional); review plan (disabled by default unless user preference says otherwise).
5. **Save.**

### 4.2 Intelligent defaults [A §C.2]

**FR-041** For `I bought it`: `boughtAt` = now; `entryPrice` = latest quote; `currency` = instrument currency; `fees` = 0; `brokerName` = last-used broker for this user, if any; `status` = `open`.

**FR-042** For `Watching`: `createdAt` = now; `status` = `watching`; **no lot is created**.

**FR-043** [R] The provenance of the entry price is recorded (`manual` vs `latest_quote`, plus the quote's as-of time) so a later reader can tell a prefilled quote from a corrected broker execution.

**FR-044** Configurable in Settings: default status for new assets; default timezone; default broker; default review preset (`Off`, 1 week, 1 month, 3 months, 6 months, 12 months, custom recurring quarterly); default notification channels for review reminders and price alerts; whether a new purchase price defaults to the latest quote.

**FR-045** [R] Saving a complete quick-add is **one request**, not a sequence. Item, optional lot, optional thesis, optional review plan and optional targets commit together or not at all. The "one-tap" promise of §C.2 is otherwise unachievable.

### 4.3 Thesis templates [A §C.3]

**FR-046** Offer, but never require, a reusable template pre-populating the thesis editor. The system default is seeded verbatim:

```text
Why I am interested / bought:

Expected outcome / catalyst:

Base target:

Main risks:

What would invalidate this idea:

What I will review on the next date:
```

**FR-047** Templates are editable in settings, and the user may create multiple named templates (e.g. `Long-term investment`, `Earnings trade`, `Speculative idea`).

---

## 5. Functional requirements — portfolio, thesis, journal

*Entirely reconstructed [R]. The addendum presupposes all of it — §J.3 says "Implement portfolio journal, thesis versioning, notes, and core item screens" — but never defines it.*

**FR-050** An `InvestmentItem` has a lifecycle status: `watching` → `open` → `closed`, plus `archived`. `watching` items hold no lots; recording a first lot moves the item to `open`.

**FR-051** Lots record `boughtAt`, `quantity` (> 0), `entryPrice` (>= 0), `currency`, `fees` (>= 0), optional `brokerName`. Money and quantity are exact decimals, never binary floating point.

**FR-052** An item shows aggregate position facts derived from its lots: total quantity, weighted-average entry price, total fees, and — when a usable quote exists — current value and unrealized P/L, **each labelled with the quote's freshness**. No value is shown as current against a `stale` or `unavailable` quote.

**FR-053** [R] **No cross-currency aggregation.** Totals are per-currency. The addendum never mentions FX rates, so the product does not invent them. See OQ-7.

**FR-054** A `Thesis` is **append-only and versioned**. Saving never overwrites: it inserts a new version and repoints the current pointer. Every version records its author and time, with an optional change summary.

**FR-055** The full version history is browsable, and any version is readable in its original form. This is what makes §E.3's "read your original thesis" meaningful months later.

**FR-056** `JournalEntry` records dated notes of kind `note`, `review`, `decision` or `event`. Completing a review may attach the journal entry it produced, linking the two.

**FR-057** Items, lots, thesis versions and journal entries are scoped to their owning user, and every read path filters by `user_id`.

**FR-058** Deletion of an item is soft by default, preserving journal and thesis history until account deletion or explicit purge.

---

## 6. Functional requirements — price targets

**FR-060** [A §D.3] A price target may be created on any item whose asset is monitorable (FR-033).

**FR-061** [R] A target has a `kind` (`base_target`, `take_profit`, `stop_loss`, `custom`), a `direction` (`above`, `below`, `crosses_above`, `crosses_below`), a threshold price and a currency.

**FR-062** [A §D.3] Price targets are **independent from delivery channels**. The editor offers:

```text
When this threshold is reached
[ ] Push notification
[ ] Email
[ ] In-app inbox
```

**FR-063** [A §D.3 + D] At least one channel must be selected for an **active, externally meaningful** price alert. If none is selected the addendum permits either storing it as a **passive/in-app-only target, clearly marked**, or requiring `In-app inbox` before activation. **Chosen behaviour: store as passive, clearly marked, behind an explicit confirmation.** Requires sign-off.

**FR-064** [R] Crossing directions require a prior observation on the other side of the threshold, so the system keeps enough recent price history to distinguish "crossed above" from "is above".

**FR-065** [R] A triggered target disarms and enters a cooldown, so a price oscillating around the threshold cannot emit an alert per poll.

**FR-066** [A §B.3] A target on a non-monitorable asset cannot be activated. The item keeps full reminder and journal functionality.

---

## 7. Functional requirements — review plans and notifications

### 7.1 A review plan is not a notification [A §D.1, §D.2]

**FR-070** Default state for a new item is **`No review planned`**, unless the user configured another default.

**FR-071** The reminder control is:

```text
Review plan
[ No review planned / Choose date / Repeat schedule ]

Notify me
[ ] Push notification
[ ] Email
[ ] In-app inbox
```

**FR-072** A review date with **no** delivery channel creates a **silent** review plan: it appears in the dashboard and calendar and dispatches nothing.

**FR-073** Enabling Push with no review date prompts the user to pick a date/time or a recurrence.

**FR-074** In-app inbox may be enabled by default. It needs no OS permission — it is a record inside the application, not an external interruption.

**FR-075** If no channels are selected, **no `NotificationEvent` is created** for that occurrence.

**FR-076** The user can enable, disable or change channels later **without recreating the reminder**.

**FR-077** [R] Channel selection has **three distinct states**, and they are not interchangeable:

| State | Meaning |
|---|---|
| *unset* | Inherit the account default for this category, resolved at dispatch time |
| *empty* | **Explicitly silent** — never notify, regardless of defaults |
| *non-empty* | Explicit override of the account default |

Collapsing *unset* and *empty* into one value makes FR-072 and acceptance criterion 7 mutually unsatisfiable.

**FR-078** [R] A review plan stores the **wall-clock local time and IANA zone** the user meant, not only a UTC instant. Recurrence advances the local date and re-resolves against the zone, so a 09:00 reminder stays at 09:00 across a DST transition.

**FR-079** [R] Every occurrence of a plan is **materialized as a record**, whether or not it notifies. Silent plans have occurrences; that is what the dashboard and calendar display, and what "overdue" is computed from.

**FR-07A** [A §F.3] A plan may carry **pre-alert offsets** (e.g. one day before), each producing its own occurrence.

### 7.2 Channels [A §E.1]

**FR-080** MVP supports exactly three channels:

| Channel | Purpose | Implementation |
|---|---|---|
| Push | Timely phone notification | OneSignal Web Push [D — spec says APNs] |
| Email | To the user's **verified** address | Resend, behind a provider abstraction [D — spec says a transactional provider behind an abstraction; the abstraction requirement is preserved] |
| In-app inbox | Durable event history and fallback | D1-backed records [D — spec says PostgreSQL] |

**FR-081** The interface must admit future channels — Telegram, Discord, Slack, web push, SMS — **without changing domain logic**.

### 7.3 Settings [A §E.2]

**FR-082** A **Notifications** settings section provides:

*Global channels* — push status (Enabled / Disabled / Permission not granted) and registered device list; email address with Verified / Needs verification status and a "Send verification email" action; in-app inbox status.

*Delivery defaults* — **separate** default channel sets for **review reminders**, **price-target alerts**, and **pre-review alerts**.

*Timing and privacy* — quiet hours (Off / e.g. 22:00–08:00), timezone, email digest for overdue reviews (Off / Daily / Weekly), lock-screen privacy (Minimal / Standard / Detailed).

**FR-083** Per-item and per-reminder channel choices **override** global defaults.

**FR-084** The settings page must **explain the effective delivery configuration**.

**FR-085** If Push is selected but permission is denied, show a clear fix action linking to the relevant settings where possible.

**FR-086** If Email is selected but unverified, it is **not** an active delivery channel; prompt verification instead.

**FR-087** The in-app inbox must record the event **even when every external channel fails**.

**FR-088** [R] The effective-configuration explanation (FR-084) is computed **server-side** and read by the UI. Reimplementing resolution rules in the client guarantees the explanation the user reads will drift from the logic that actually runs.

### 7.4 Email verification and deliverability [A §E.3]

**FR-090** Use the verified account email, or allow a separate verified notification address.

**FR-091** Require email verification **before** sending investment-related reminder messages.

**FR-092** Support unsubscribe / disable-email controls in settings and in the email footer.

**FR-093** **Do not include sensitive full thesis text in emails by default.**

**FR-094** Emails include asset name, event type, scheduled/triggered time, and a deep link to the relevant in-app screen.

Reference subject and body [A §E.3]:

```text
Review due: MSFT — revisit your investment thesis
```

```text
Your planned review for MSFT is due.

Original entry: $412.30
Base target: $480.00
Planned review date: 3 Sep 2026

Open the app to read your original thesis, review what changed, and decide the next action.
```

### 7.5 Quiet hours and escalation [A §E.4]

**FR-095** Quiet hours apply to Push by default and **may optionally** apply to email.

**FR-096** An event occurring during quiet hours is **queued for delivery at the end of quiet hours**, unless marked critical.

**FR-097** "Critical" is an advanced user-defined setting only. **iOS Critical Alerts entitlement must not be used in MVP.**

**FR-098** **Never silently discard an event because of quiet hours.** Persist it and show it in the in-app inbox.

**FR-099** [R] The in-app record is written immediately at the original time; only *external* delivery is deferred. Deferring the inbox record would violate FR-098.

### 7.6 Dispatch rules [A §H.1]

**FR-0A0** Reminder processing:

1. find a due review-plan occurrence;
2. determine effective channels — reminder-level override, otherwise account defaults;
3. **if the effective channel set is empty, create no notification event**; the reminder stays due in the app;
4. if channels exist, create the durable notification event **transactionally with an idempotency key**;
5. create/ensure an in-app inbox record if `in_app` is selected;
6. dispatch Push and Email **independently** through channel-specific workers;
7. apply quiet-hours policy **without losing the event**;
8. **record every provider response and final delivery state**.

**FR-0A1** [A §F.4] An occurrence has **exactly one** notification event, enforced by a **unique deduplication key** — a storage constraint, not an application convention.

**FR-0A2** [A §F.4] Each requested channel has its own status, attempts, provider response/error and timestamps.

**FR-0A3** [A §F.4] **A Push failure must not prevent an Email attempt, and vice versa.**

**FR-0A4** [A §F.4] In-app creation is attempted first and is the durable fallback.

**FR-0A5** [R] **Channel eligibility is evaluated per delivery, not during resolution.** An unverified email or missing push subscription produces a delivery row with `skipped` status and a specific reason — never a silently removed channel. A channel dropped before the event is written leaves no evidence, which makes the diagnostics requirement (acceptance criterion 10) unsatisfiable.

**FR-0A6** [R] Delivery is **at-least-once**. The attempt counter increments before the provider call, bounding duplicates. Exactly-once is not attempted and not claimed.

### 7.7 Channel abstraction [A §H.2]

**FR-0A7** A notification-channel interface equivalent to:

```csharp
public interface INotificationChannel
{
    NotificationChannelType Type { get; }
    Task<DeliveryResult> SendAsync(NotificationMessage message, CancellationToken cancellationToken);
}
```

with initial implementations for push, email and in-app. [D — rendered in TypeScript; see ADR-0002. The addendum says "similar to", so the shape is illustrative]

**FR-0A8** **Domain logic must depend on the interface, not on APNs or a specific email provider.** Enforced mechanically by lint rules, not by convention.

---

## 8. Functional requirements — settings, data rights, diagnostics

**FR-0B0** [A §F.1] User settings persist: default timezone; default new-item status; default review plan (mode, preset, channels); default review channels; default price-alert channels; default pre-review channels; whether entry price prefills from the latest quote; default broker; lock-screen privacy; quiet hours (enabled, start, end, apply-to-email); overdue digest mode.

**FR-0B1** [A §G.3] A **notification diagnostics** view reports push permission and registered subscriptions, email address and verification state, in-app status, quiet-hours state, the **effective defaults**, and recent events with their per-channel delivery outcomes and provider errors.

**FR-0B2** [R, from §J.9] The user can **export** their full account data in a machine-readable form.

**FR-0B3** [R, from §J.9] The user can **request account deletion**, with a grace period before irreversible purge.

---

## 9. Non-functional requirements

**NFR-01 Correctness of time.** All scheduling is DST-correct. Recurrence advances local dates and re-resolves against the IANA zone. Nonexistent and ambiguous local times resolve by an explicit, tested policy. No wall-clock arithmetic on UTC instants.

**NFR-02 Idempotency.** Duplicate dispatch cycles, retries and concurrent workers must not produce duplicate events, occurrences or inbox items. Enforced by unique constraints, not by locking discipline alone.

**NFR-03 Durability.** No event is ever dropped. Quiet hours, provider outages and permission failures defer or annotate; they never discard.

**NFR-04 Observability.** Every external provider call records status, latency and response. Every delivery records its final state and error.

**NFR-05 Testability.** All time-dependent logic takes an injected clock. All provider calls go through ports with deterministic fakes. No test touches a live external API.

**NFR-06 Cost.** The system runs within the Cloudflare free tier for personal use: 100k requests/day, 100k D1 row-writes/day, 5M D1 row-reads/day, 10k queue ops/day. Quote caching and provider-call accounting use KV to protect the D1 write budget.

**NFR-07 Privacy.** Thesis text is sensitive. It is never included in emails by default (FR-093), and lock-screen privacy controls what appears in push payloads.

**NFR-08 Security.** Session cookies are HttpOnly and SameSite. Verification and unsubscribe tokens are stored hashed, single-use and expiring. All user-scoped reads filter by owner.

**NFR-09 Accessibility.** Keyboard-navigable, labelled form controls, and freshness/status conveyed by text — never by colour alone.

---

## 10. Acceptance criteria [A §I]

Binding and unchanged. `03-traceability.md` maps each to its phase and proving test.

1. Entering `MSFT` presents a disambiguated search result containing the company name, NASDAQ, stock type, and USD.
2. Selecting the result auto-fills symbol, name, exchange, currency, asset type, latest available price, quote timestamp/freshness, and current creation time.
3. Selecting `I bought it` auto-fills purchase date/time with now, entry price with latest quote, fees with zero, and status with `open`; the user can edit all execution-specific values.
4. A user can save an investment item without any time-based review date or push notification.
5. A user can create a review date visible in the app but choose no Push or Email; it appears in the calendar/dashboard and does not create external delivery attempts.
6. A user can set a review reminder with Push only, Email only, In-app only, or any combination of these.
7. The user can set global default channels separately for review reminders and price targets, and a specific reminder can override those defaults.
8. Email cannot be selected as an active delivery method until the user verifies the notification email address.
9. A scheduled event with Push + Email creates one event and separate channel delivery records; a failure in one channel does not block the other.
10. If Push permission is denied or delivery fails, the notification diagnostic screen identifies the issue, and the in-app inbox/dashboard retains the event when that channel was selected.
11. A reminder created with no notification channels creates no external notification but remains due/overdue in the product UI.
12. The user can change default entry behavior, default review behavior, default notification channels, timezone, privacy, and quiet hours in Settings.

> **Note on criterion 10** [D]: the addendum says "iOS Push permission". Under decision 3 this is OneSignal Web Push permission, including the iOS Add-to-Home-Screen precondition. The diagnostic requirement itself is unchanged.

---

## 11. Out of scope for MVP

Broker/bank connectivity · order placement · tax lots and tax reporting · FX conversion and cross-currency totals · options, futures and derivatives modelling · social or sharing features · backtesting · news and sentiment feeds · iOS Critical Alerts [A §E.4] · native mobile applications [D, decision 1] · Telegram/Slack/Discord/SMS channels — the abstraction must permit them, but no adapter ships in MVP [A §E.1].

---

## 12. Sign-off

This document is binding once approved. Until then, everything tagged **[R]** is an inference and everything tagged **[D]** is a proposed departure from the addendum's letter.

The reviewer should confirm, at minimum:

- §0.3 decisions 1–7;
- FR-053 — no cross-currency totals;
- FR-063 — passive targets chosen over forced in-app;
- FR-077 — three-state channel semantics;
- FR-0A5 — skipped deliveries recorded rather than filtered;
- the open questions in `02-assumptions.md`.

| Role | Name | Date | Decision |
|---|---|---|---|
| Product owner | | | [ ] Approved  [ ] Changes requested |
