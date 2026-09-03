# ADR-0004: React PWA served by the same Worker

**Status:** Accepted · **Date:** 2026-09-03 · **Relates to:** ASM-002, FR-071, spec §C.1, §D.2, §E.2

## Context

The addendum describes iOS screens. The client is now a browser app (ASM-002). Two things constrain the choice more than taste:

1. **iOS web push requires a real PWA** — a manifest with `display: standalone`, a service worker, HTTPS, and the user adding the app to the Home Screen.
2. **OneSignal registers its own service worker.** Any framework that also ships one creates two service workers on one origin.

## Decision

**React 19 + Vite 7 + TypeScript**, built to static assets and served by the **same Worker** that serves the API.

Single origin is the load-bearing part: it gives HttpOnly `SameSite` cookie auth with no CORS, no token-refresh choreography inside a service worker, and puts the SW on the same origin as the API it caches.

Service workers are kept **separate, not merged**: `vite-plugin-pwa` in `injectManifest` mode owns `/sw.js` at scope `/`; OneSignal's `OneSignalSDKWorker.js` registers at scope `/push/onesignal/`. Merging them via `importScripts` works but couples our Workbox build to OneSignal's SDK release cadence for no benefit.

## Consequences

- Static asset requests are free and unlimited on the Workers free plan, so the UI costs nothing against the request budget.
- Zod schemas in `packages/shared` are used by both the API and the forms, so validation is defined once.
- **Quotes are never served from the offline cache as if current** (FR-023). The service worker uses `NetworkFirst` for inbox and review data, `CacheFirst` only for hashed static assets, and never caches quote responses as fresh.
- Times render in the user's *configured* IANA zone, not the device zone, so what the UI shows matches what the scheduler will do.

## Alternatives rejected

- **Blazor WASM** — ships its own PWA service worker, colliding with OneSignal's on the same origin, and adds a `_framework` payload on mobile.
- **Blazor Server** — a persistent WebSocket is the wrong model for a PWA launched intermittently from an iOS Home Screen and killed aggressively by the OS.
- **Separate origins for app and API** — reintroduces CORS and complicates cookie auth for no gain.
