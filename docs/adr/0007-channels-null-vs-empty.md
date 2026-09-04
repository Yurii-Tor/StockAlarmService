# ADR-0007: `channels` is three-state — `NULL` is not `[]`

**Status:** Accepted · **Date:** 2026-09-03 · **Relates to:** ASM-020, FR-072, FR-075, FR-077, FR-083, criteria 5, 7, 11

## Context

§D.1 lists six configurations that must all be possible, two of which are only distinguishable if "no channels chosen" and "no choice made" are different values:

> 2. A review date visible only inside the app, with no external notification.
> 6. A review date with a repeated schedule but notifications turned off.

Meanwhile §E.2 requires account-level defaults, and §I.7 requires a specific reminder to **override** them.

Consider a reminder saved with no channels ticked, and an account default of `["push","in_app"]`. If the stored value is an empty array and empty means "use the default", the reminder notifies — violating §D.1 case 2 and criterion 5. If empty means "silent", then a reminder that should follow the account default has no way to say so, and changing the account default can never affect existing reminders — which is what a default is for.

**One value cannot carry both meanings.** Three states are required.

## Decision

`review_reminders.channels` and `price_targets.channels` are **nullable** columns holding JSON:

| Stored | Meaning | Dispatch behaviour |
|---|---|---|
| `NULL` | **Inherit** the account default for this category | Resolved at dispatch time, so changing the account default retroactively changes this reminder — which is what "default" means |
| `'[]'` | **Explicitly silent** | Never creates a `NotificationEvent`. Occurrence becomes `skipped_silent`, and stays visible on dashboard and calendar |
| `'["push","email"]'` | **Explicit override** | Overrides the account default (criterion 7) |

Resolution is a pure function in `domain/channels/resolver.ts`:

```ts
const configured = entity.channels ?? settings.defaultsFor(category);
if (configured.length === 0) return ChannelSet.silent();   // no event, ever
return ChannelSet.of(configured);
```

## Consequences

- The API accepts and returns `channels: null | string[]`. **`undefined` and `null` must not be conflated on the wire** — omitting the field on a PATCH means "leave unchanged"; sending `null` means "revert to inheriting".
- The Zod schema is `z.array(channelEnum).nullable()`, never `.default([])`. A `.default([])` silently converts every inheriting reminder into a permanently silent one.
- The three states are covered by dedicated tests in `channel-resolver.test.ts`, and criteria 5, 7 and 11 all depend on them.
- Category matters: §E.2 requires **separate** defaults for review reminders, price-target alerts and pre-review alerts, so `defaultsFor(category)` takes the category rather than reading one global list.

## The failure mode this exists to prevent

A DTO or ORM model typed as non-nullable `string[]`, or a form library that normalizes `null` to `[]`, destroys the distinction **silently**. Nothing throws. Every inheriting reminder simply stops notifying, and the account default stops having any effect. The bug surfaces weeks later as "my reminders stopped working".

This is why the constraint lives in the database (`channels TEXT NULL`, no `NOT NULL`, no default) and in a lint-visible type, not in a comment.
