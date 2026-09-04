# ADR-0005: OneSignal Web Push replaces APNs

**Status:** Accepted · **Date:** 2026-09-03 · **Relates to:** ASM-004, FR-080, FR-085, criterion 10

## Context

§E.1 specifies "APNs with registered device tokens". APNs requires a native iOS app, an Apple Developer account, and a Mac to build on — none of which apply (ASM-002). The user directed that OneSignal be used instead.

One thing had to be checked rather than assumed: the App Store app named **"OneSignal Push Notification" is a *sender* utility for developers**, not a receiver. It cannot receive notifications from our app. So "install OneSignal from the App Store and get our pushes" is not a working path.

The path that does work is **OneSignal Web Push** against our PWA.

## Decision

Push is delivered through the **OneSignal REST API**, targeting users by the alias OneSignal calls `external_id`, which we set to our own `users.id`.

```
POST https://api.onesignal.com/notifications
Authorization: Key <REST_API_KEY>

{ "app_id": "...", "target_channel": "push",
  "include_aliases": { "external_id": ["<users.id>"] },
  "headings": {"en": "..."}, "contents": {"en": "..."}, "url": "<deep link>" }
```

Exactly one targeting method per request. The frontend binds the alias with `OneSignal.login(user.id)` after sign-in.

**Response mapping** — the part implementations usually get wrong:

| Response | Delivery outcome |
|---|---|
| 200 **with** `id` | `sent`; store `id` as `provider_message_id` |
| 200 **without** `id` | `skipped`, reason `no_push_subscription` — **not** a retryable failure |
| 400 / 401 / 403 | terminal `failed` |
| 429 / 5xx / timeout | retryable with backoff |

A 200 without an `id` means there were no valid subscriptions. Retrying it five times accomplishes nothing and buries the real diagnosis — usually that the user never completed Add-to-Home-Screen — under generic failure noise. Mapping it to an explicit skip reason is what makes criterion 10's diagnostics screen useful.

## Consequences: iOS is best-effort, and the product says so

Delivering to an iPhone requires **all** of: iOS/iPadOS 16.4+; HTTPS; a manifest with `display: standalone`; the OneSignal service worker; and the user adding the app to the Home Screen and launching it **from there**. The permission prompt cannot fire on page load — a prior user gesture is required. If the user denies, iOS offers no second chance: they must remove the Home Screen app and re-add it.

Therefore:

- The UI detects `navigator.standalone === false` and shows install instructions **instead of** an enable button that would silently do nothing.
- **Email and the in-app inbox are the reliable channels on iOS; push is best-effort.** The spec already anticipated this — FR-087 requires the inbox to record the event even when every external channel fails.
- Desktop browsers and Android need no install and behave normally.

## Future

Swapping OneSignal for direct Web Push (VAPID) or a native app with APNs is an adapter change behind `NotificationChannel`. No domain code moves.
