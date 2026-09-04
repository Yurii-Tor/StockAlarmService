# ADR-0006: Magic link + Google, same-origin cookie sessions

**Status:** Accepted · **Date:** 2026-09-03 · **Relates to:** ASM-001, FR-090, FR-091, NFR-08

## Context

**The addendum never mentions authentication.** Not once, in any of sections A–J. Yet it presupposes users throughout: per-user settings (§F.1), "the user's verified email address" (§E.3), registered devices (§E.2), and a `userId` in the settings payload.

This is the single largest hole left by the missing base specification. Something had to be chosen, and the choice constrains the frontend, the deployment topology and the deep-link behaviour of every notification.

## Decision

**Better Auth** with a Drizzle/D1 adapter, providing:

- **magic link** as the primary sign-in method;
- **Google OAuth** as a social option;
- **HttpOnly, `SameSite=Lax` session cookies** on the single origin (ADR-0004).

## Rationale

The decisive point is that **magic link and email verification are the same mechanism.** §E.3 already requires a verified-email flow before any reminder can be sent. Building password auth would mean building that flow anyway, plus password hashing, reset, and breach handling — two mechanisms where one suffices.

Beyond that: HttpOnly cookies keep credentials out of JavaScript, which matters more than usual here because a service worker runs on the same origin; and a single origin removes CORS and token-refresh choreography from the service worker entirely.

## Consequences

- **Email deliverability becomes a sign-in dependency, not just a notification one.** If Resend cannot deliver, users cannot log in. Google OAuth is the mitigation, and is why it ships in MVP rather than later.
- Anti-forgery tokens are required on cookie-authenticated mutations.
- Verification and unsubscribe tokens are stored **hashed**, single-use, and expiring (NFR-08).
- The *notification* email address may differ from the *account* email (FR-090). They are separate records with separate verification state.

## Resolved: no Apple sign-in

**Sign in with Apple is out of scope** (OQ-1, closed 2026-09-04). It requires an Apple Developer Program membership at $99/yr, which the user does not hold and does not intend to buy.

This costs nothing architecturally. Providers are additive: adding Apple later is configuration plus a callback route, and changes no domain code. It is worth noting that the same membership is what direct APNs would have required, so declining it is consistent with ADR-0005.

## Known operational dependency

Magic link makes **email deliverability a sign-in dependency**, not merely a notification one. If Resend cannot deliver, users cannot log in. Google OAuth is the mitigation and is why it ships in MVP rather than later (OQ-12, OQ-13).

## Alternatives rejected

- **Email + password** — two mechanisms where one suffices, plus a password to leak.
- **JWT in `localStorage`** — XSS-readable, with no compensating benefit at a single origin.
- **Auth0 / Keycloak / Clerk** — operational weight and cost disproportionate to a personal-scale app, and a hosted IdP is another thing that must stay free.
