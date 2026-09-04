# ADR-0002: TypeScript on Workers instead of .NET

**Status:** Accepted · **Date:** 2026-09-03 · **Relates to:** ASM-008, spec §H.2

## Context

§H.2 specifies the channel abstraction with a C# signature, implying a .NET service. The user initially chose .NET 10, then chose free Cloudflare hosting. These are incompatible:

- Cloudflare Workers execute JS/TS/Rust/Python on `workerd`. There is no CLR.
- Cloudflare Containers, the only way to run a .NET image on Cloudflare, is paid-only ($5/mo Workers Paid plan).

Free .NET hosting elsewhere fails on the property this product cannot do without: **scheduled work must fire while nobody is using the app.** Render free sleeps after 15 minutes. Fly.io removed its free allowance. Azure F1 caps at 60 CPU-minutes/day. Oracle Always Free was halved to 2 OCPU/12 GB in June 2026 and reclaims instances idling below 20% CPU over 7 days — exactly the profile of a reminder service.

Cloudflare Cron Triggers fire regardless of traffic.

## Decision

Implement the service in **TypeScript on Cloudflare Workers**.

§H.2's interface becomes:

```ts
export interface NotificationChannel {
  readonly type: NotificationChannelType;
  send(message: NotificationMessage, signal: AbortSignal): Promise<DeliveryResult>;
}
```

The addendum says "an interface *similar to*", so the C# syntax is illustrative. What is binding is the sentence that follows it: *"The domain logic must depend on the interface, not directly on APNs or a specific email provider."*

## Consequences

- That binding rule is enforced **mechanically**, not by convention. ESLint `no-restricted-imports` forbids `onesignal`, `resend`, `finnhub`, `drizzle-orm` and `cloudflare:*` inside `worker/src/domain/**` and `worker/src/app/**`. A second rule bans `Date.now()` and `new Date()` outside `adapters/`, because all time must come from the injected `Clock` port (NFR-05).
- Both rules are CI gates. Phase 1 is not done until a deliberately introduced violation fails the build.
- Neither the .NET 10 SDK nor Docker is required. `wrangler dev` runs the whole stack locally with real D1, DO and Queue bindings via Miniflare.
- Tests run **inside `workerd`** via `@cloudflare/vitest-pool-workers`, so integration tests exercise the real bindings rather than mocks of them.
