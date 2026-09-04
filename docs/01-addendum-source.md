# Addendum: Fast Ticker Entry, Optional Time Pushes, and Notification Channels

Apply the following changes to the original **Investment Thesis & Review Reminder App** technical specification. These are mandatory product requirements.

## A. Product Principle: Minimize Manual Entry

The application must minimize repeated manual work. When the user enters or selects a ticker, the system must automatically resolve the asset and prefill every field that can be safely obtained from market data, the device, the user profile, or deterministic defaults.

The user should only need to enter the information that cannot be known by the system, primarily:

- Whether they actually bought the asset or are only watching it.
- Quantity, actual execution price, and fees if recording a real purchase.
- Their investment thesis, risks, and personal decision context.
- Any non-default target prices or review plan.

Do not make the user manually enter a date/time, currency, company name, asset type, exchange, or current quote when this data is available automatically.

## B. Ticker Search and Asset Resolution

### B.1 Search behavior

The “Add Investment Item” flow must start with a single ticker/name search input.

As the user types, query a server-side symbol-search endpoint backed by the configured market-data provider. Search results must include, where available:

- Symbol/ticker
- Asset/company/fund name
- Asset type
- Exchange/MIC or market name
- Listing currency
- Country/region, when available
- Instrument identifier such as ISIN, FIGI, or provider-specific ID, when available
- A distinguishable label for duplicate ticker symbols

Example result format:

```text
MSFT — Microsoft Corporation
NASDAQ · Stock · USD
```

If multiple listings share a symbol, the user must choose the specific listing. Never automatically assume a ticker is unique across all exchanges.

### B.2 Selection behavior

Immediately after the user selects an instrument, call an asset-details/quote endpoint and prefill the draft item.

Auto-populate the following when available:

| Field | Source | User can edit? |
|---|---|---|
| Symbol | Selected market instrument | Normally no; change by selecting another instrument |
| Display name | Provider instrument metadata | Yes |
| Asset type | Provider metadata | Yes for manual correction |
| Exchange/market | Provider metadata | Change only by choosing another listing |
| Currency | Provider metadata | Yes, if user uses a custom/manual item |
| Provider instrument ID | Provider metadata | No UI editing needed |
| ISIN/FIGI/other ID | Provider metadata where available | Read-only |
| Current/last price | Latest quote | No manual edit; refreshable |
| Quote timestamp | Latest quote | Read-only |
| Quote freshness/status | Computed from quote timestamp | Read-only |
| Created date/time | Current device/account time | Yes |
| Default timezone | Account default or device timezone | Yes |
| Default asset status | User preference, default `watching` | Yes |
| Default review plan | User preference, default disabled | Yes |
| Default notification channels | User notification preferences | Yes per reminder/alert |

Display data provenance and freshness clearly. For example:

```text
Last price: $480.15
NASDAQ · USD · quote delayed 15 min · as of 2026-09-03 12:35 EEST
```

The system must never label stale or unavailable data as “current.”

### B.3 Draft states and failures

- The user may save a manual/custom asset if lookup fails.
- If search metadata is found but quote retrieval fails, retain the selected instrument metadata and show `Price unavailable` with a retry action.
- If a provider only supplies delayed quotes, show the delay/freshness state in the UI and include it in relevant alert details.
- Prevent target-monitoring activation if the asset cannot be mapped to a monitorable provider instrument. The user may still use reminders and journal fields.
- Cache asset metadata and quote results to reduce repeated external calls, but obey provider licensing and freshness requirements.

## C. Smart Quick-Add Flow

### C.1 Default flow

After choosing an instrument, show a compact, prefilled form rather than a long blank form.

Suggested layout:

1. **Selected asset card**
   - Symbol, name, exchange, asset type, currency
   - Latest price and quote timestamp
2. **Intent selector**
   - `Watching` (default)
   - `I bought it`
3. **Purchase section**, shown only if `I bought it`
   - Buy date/time defaults to now
   - Purchase price defaults to latest quote
   - Currency defaults to instrument currency
   - Quantity defaults to empty and is required
   - Fees default to 0
   - All fields are editable because actual broker execution can differ from a market quote
4. **Decision summary**
   - Thesis: optional for quick save, but strongly prompted for open positions
   - Base target price: optional
   - Review plan: disabled by default unless user preference says otherwise
5. **Save**

### C.2 One-tap intelligent defaults

For `I bought it`, prefill:

- `boughtAt`: current local date/time.
- `entryPrice`: latest available quote.
- `currency`: instrument currency.
- `fees`: `0`.
- `brokerName`: last-used broker for this user, if any.
- `status`: `open`.

For `Watching`, prefill:

- `createdAt`: current date/time.
- `status`: `watching`.
- No lot is created.

Allow the user to configure defaults in Settings:

- Default status for new assets: `watching` or `open`.
- Default timezone.
- Default broker.
- Default review preset: `Off`, 1 week, 1 month, 3 months, 6 months, 12 months, custom recurring quarterly.
- Default notification channels for review reminders and price alerts.
- Whether newly entered purchase price should default to latest quote.

### C.3 Optional thesis template

Offer, but do not require, a reusable template that pre-populates the thesis editor:

```text
Why I am interested / bought:

Expected outcome / catalyst:

Base target:

Main risks:

What would invalidate this idea:

What I will review on the next date:
```

The template must be editable in settings. The user can create multiple named templates, e.g. `Long-term investment`, `Earnings trade`, `Speculative idea`.

## D. Optional Timer-Based Push Reminders

### D.1 Principle

Time-based reminder notifications are entirely optional. Creating an asset, watchlist item, lot, thesis, target price, or price alert must not require a review deadline or a timer-based push.

The application must distinguish between:

- A **review plan record**: a planned date or recurrence kept in the app.
- A **notification delivery**: whether and where the user wants to receive an alert about that plan.

A user may have:

1. No review date and no reminder.
2. A review date visible only inside the app, with no external notification.
3. A review date with push notification.
4. A review date with email notification.
5. A review date with both push and email.
6. A review date with a repeated schedule but notifications turned off.

### D.2 Reminder UI

In the item creation/edit screen, use this control:

```text
Review plan
[ No review planned / Choose date / Repeat schedule ]

Notify me
[ ] Push notification
[ ] Email
[ ] In-app inbox
```

Rules:

- Default state: `No review planned` unless the user has configured another default.
- If a user chooses a review date but no delivery channel, create a `silent` review plan. It appears in dashboard/calendar but does not dispatch push or email.
- If a user enables Push without a review date, prompt them to select a date/time or a recurrence.
- In-app inbox can be enabled by default and does not require OS permission; it is a record within the application, not an external interruption.
- If no channels are selected, do not create a `NotificationEvent` for the reminder occurrence.
- The user can enable, disable, or change channels later without recreating the reminder.

### D.3 Price-alert delivery is also configurable

Price targets are also independent from delivery channels.

When creating or editing a price target, the UI must offer:

```text
When this threshold is reached
[ ] Push notification
[ ] Email
[ ] In-app inbox
```

At least one channel must be selected for an active, externally meaningful price alert. If none is selected, either:

- Store it as a passive/in-app-only target, clearly marked as such; or
- Require the user to select `In-app inbox` before activating it.

## E. Notification Channel Settings

### E.1 Required channels

Support these notification channels in MVP:

| Channel | Purpose | Technical implementation |
|---|---|---|
| iOS Push | Timely phone notification | APNs with registered device tokens |
| Email | Delivered to the user’s verified email address | Transactional email provider via a provider abstraction |
| In-app inbox | Durable event history and fallback | PostgreSQL-backed notification/event records |

Design the interface so future channels can be added without changing domain logic, e.g. Telegram, Discord, Slack, web push, or SMS.

### E.2 Settings screen

Add a **Notifications** section in application settings with the following controls.

#### Global channels

```text
Push notifications
Status: Enabled / Disabled / Permission not granted
Registered devices: [device list]

Email notifications
Address: user@example.com
Status: Verified / Needs verification
[Send verification email]

In-app inbox
Status: Enabled
```

#### Delivery defaults

```text
Review reminders
Default channels: [Push] [Email] [In-app inbox]

Price-target alerts
Default channels: [Push] [Email] [In-app inbox]

Pre-review alerts
Default channels: [Push] [Email] [In-app inbox]
```

#### Timing and privacy

```text
Quiet hours: [Off / 22:00–08:00]
Timezone: Europe/Bucharest
Email digest for overdue reviews: [Off / Daily / Weekly]
Lock-screen privacy: [Minimal / Standard / Detailed]
```

Required behavior:

- Per-item and per-reminder channel choices override global defaults.
- The settings page must explain the effective delivery configuration.
- If Push is selected but iOS permission is denied, show a clear fix action that links to the app’s Settings page where possible.
- If Email is selected but the email is not verified, do not treat it as an active delivery channel; prompt verification.
- In-app inbox must record the event even when all external channels fail.

### E.3 Email verification and deliverability

- Use a verified account email address or allow a separate verified notification email address.
- Require an email-verification flow before sending investment-related reminder messages.
- Support unsubscribe/disable-email controls in the settings screen and email footer as appropriate.
- Do not include sensitive full thesis text in emails by default.
- Email messages must include the asset name, event type, scheduled/triggered time, and a deep link to the relevant in-app screen.

Example email subject:

```text
Review due: MSFT — revisit your investment thesis
```

Example email body:

```text
Your planned review for MSFT is due.

Original entry: $412.30
Base target: $480.00
Planned review date: 3 Sep 2026

Open the app to read your original thesis, review what changed, and decide the next action.
```

### E.4 Quiet hours and escalation

- Quiet hours apply to Push by default and may optionally apply to email.
- If an event occurs during quiet hours, queue it for delivery at the end of quiet hours unless the user marks the alert as critical.
- “Critical” is an advanced user-defined setting only; do not use iOS Critical Alerts entitlement in MVP.
- Never silently discard an event because of quiet hours; persist it and show it in the in-app inbox.

## F. Data Model Changes

### F.1 User settings

Add fields equivalent to:

```json
{
  "userId": "uuid",
  "defaultTimezone": "Europe/Bucharest",
  "defaultNewItemStatus": "watching",
  "defaultReviewPlan": {
    "mode": "none",
    "preset": null,
    "channels": ["in_app"]
  },
  "defaultReviewChannels": ["in_app"],
  "defaultPriceAlertChannels": ["push", "in_app"],
  "prefillEntryPriceFromLatestQuote": true,
  "defaultBrokerName": null,
  "lockScreenPrivacy": "minimal",
  "quietHours": {
    "enabled": false,
    "startLocalTime": "22:00",
    "endLocalTime": "08:00",
    "applyToEmail": false
  }
}
```

### F.2 Instrument metadata

Add an `Instruments` table or equivalent cached provider mapping:

```json
{
  "id": "uuid",
  "provider": "provider_name",
  "providerInstrumentId": "string",
  "symbol": "MSFT",
  "displayName": "Microsoft Corporation",
  "assetType": "stock",
  "exchange": "NASDAQ",
  "mic": "XNAS",
  "currency": "USD",
  "isin": null,
  "figi": null,
  "isMonitorable": true,
  "metadataUpdatedAt": "2026-09-03T10:35:00Z"
}
```

`InvestmentItems` must reference the resolved `Instrument` where one exists, while retaining a manual asset option.

### F.3 Review reminders

Update `ReviewReminders` to separate schedule from channels:

```json
{
  "id": "uuid",
  "investmentItemId": "uuid",
  "scheduledFor": "2026-12-03T09:00:00Z",
  "timezone": "Europe/Bucharest",
  "repeatRule": "none",
  "enabled": true,
  "channels": ["push", "email", "in_app"],
  "preAlertOffsets": ["P1D"],
  "status": "scheduled"
}
```

`channels` may be an array on the reminder entity for MVP. For more advanced future support, normalize it into `ReminderDeliveryPreferences`.

### F.4 Notification events and deliveries

`NotificationEvents` represent the occurrence. `NotificationDeliveries` represent attempts by channel.

```json
{
  "notificationEvent": {
    "id": "uuid",
    "sourceType": "review_reminder",
    "sourceId": "uuid",
    "channelsRequested": ["push", "email", "in_app"],
    "status": "pending",
    "deduplicationKey": "review-reminder:{id}:{occurrenceUtc}"
  },
  "deliveries": [
    {
      "channel": "push",
      "status": "sent",
      "attemptedAt": "2026-12-03T09:00:10Z"
    },
    {
      "channel": "email",
      "status": "sent",
      "attemptedAt": "2026-12-03T09:00:12Z"
    },
    {
      "channel": "in_app",
      "status": "created",
      "attemptedAt": "2026-12-03T09:00:00Z"
    }
  ]
}
```

Rules:

- An occurrence has exactly one notification event, enforced by unique deduplication key.
- Each requested delivery channel has its own status, attempts, provider response/error, and timestamps.
- A Push failure must not prevent an Email attempt, and vice versa.
- In-app creation should be attempted first and is the durable fallback.
- If no channel is configured for an occurrence, do not create a NotificationEvent; the review plan remains visible in dashboard/calendar.

## G. API Changes

Add or update the following API capabilities.

### G.1 Instrument discovery

- `GET /instruments/search?q={query}&assetType={optional}`
- `GET /instruments/{instrumentId}`
- `GET /instruments/{instrumentId}/quote`

Search response must return enough metadata for a user to distinguish duplicate listings.

### G.2 Fast draft creation

- `POST /investment-items/draft-from-instrument`

Example request:

```json
{
  "instrumentId": "uuid",
  "intent": "open",
  "useLatestQuoteAsEntryPrice": true,
  "timezone": "Europe/Bucharest"
}
```

Example response must include a fully prefilled editable draft:

```json
{
  "investmentItemDraft": {
    "symbol": "MSFT",
    "name": "Microsoft Corporation",
    "assetType": "stock",
    "exchange": "NASDAQ",
    "currency": "USD",
    "createdAt": "2026-09-03T12:36:00+03:00",
    "status": "open"
  },
  "lotDraft": {
    "boughtAt": "2026-09-03T12:36:00+03:00",
    "entryPrice": "480.15",
    "quoteAsOf": "2026-09-03T12:35:40+03:00",
    "fees": "0.00"
  },
  "defaultReviewPlan": {
    "mode": "none",
    "channels": ["in_app"]
  }
}
```

### G.3 Notification settings and channels

- `GET /user-settings/notifications`
- `PATCH /user-settings/notifications`
- `POST /email-notification-address`
- `POST /email-notification-address/verify`
- `POST /devices/register`
- `GET /notification-diagnostics`

Update create/edit reminder and target endpoints to accept a `channels` field and explicit delivery overrides.

## H. Background Job Changes

### H.1 Reminder dispatch

Update reminder processing rules:

1. Find a due review-plan occurrence.
2. Determine effective channels: item/reminder-level override, otherwise account defaults.
3. If the effective channel set is empty, do not create a notification event. Keep the reminder as due in the app.
4. If channels exist, create the durable notification event transactionally with an idempotency key.
5. Create/ensure an in-app inbox record if `in_app` is selected.
6. Dispatch Push and Email independently through channel-specific workers.
7. Apply quiet-hours policy without losing the event.
8. Record every provider response and final delivery state.

### H.2 Channel abstraction

Implement a notification interface similar to:

```csharp
public interface INotificationChannel
{
    NotificationChannelType Type { get; }
    Task<DeliveryResult> SendAsync(NotificationMessage message, CancellationToken cancellationToken);
}
```

Initial implementations:

- `ApnsNotificationChannel`
- `EmailNotificationChannel`
- `InAppNotificationChannel`

The domain logic must depend on the interface, not directly on APNs or a specific email provider.

## I. Updated Acceptance Criteria

In addition to all previous acceptance criteria, demonstrate the following:

1. Entering `MSFT` presents a disambiguated search result containing the company name, NASDAQ, stock type, and USD.
2. Selecting the result auto-fills symbol, name, exchange, currency, asset type, latest available price, quote timestamp/freshness, and current creation time.
3. Selecting `I bought it` auto-fills purchase date/time with now, entry price with latest quote, fees with zero, and status with `open`; the user can edit all execution-specific values.
4. A user can save an investment item without any time-based review date or push notification.
5. A user can create a review date visible in the app but choose no Push or Email; it appears in the calendar/dashboard and does not create external delivery attempts.
6. A user can set a review reminder with Push only, Email only, In-app only, or any combination of these.
7. The user can set global default channels separately for review reminders and price targets, and a specific reminder can override those defaults.
8. Email cannot be selected as an active delivery method until the user verifies the notification email address.
9. A scheduled event with Push + Email creates one event and separate channel delivery records; a failure in one channel does not block the other.
10. If iOS Push permission is denied or APNs delivery fails, the notification diagnostic screen identifies the issue, and the in-app inbox/dashboard retains the event when that channel was selected.
11. A reminder created with no notification channels creates no external notification but remains due/overdue in the product UI.
12. The user can change default entry behavior, default review behavior, default notification channels, timezone, privacy, and quiet hours in Settings.

## J. Revised Build Order

1. Implement instrument search, provider instrument mapping, quote lookup/cache, and the prefilled quick-add draft API.
2. Implement the fast iOS entry UI: selected asset card, intent selector, purchase defaults, editable quote-based purchase draft.
3. Implement portfolio journal, thesis versioning, notes, and core item screens.
4. Implement review plans independently from notification delivery; support silent/in-app-only reminders.
5. Implement Settings, email verification, notification defaults, per-reminder overrides, and in-app inbox.
6. Implement APNs Push, transactional email provider, notification-channel abstraction, and delivery diagnostics.
7. Implement durable scheduling, quiet hours, retries, idempotency, and recurring review behavior.
8. Add price targets/monitoring and reuse the same configurable delivery pipeline.
9. Complete export, deletion, observability, automated tests, Docker, CI, and documentation.
