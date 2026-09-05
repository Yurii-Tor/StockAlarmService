import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import type { Database } from '../db/client';
import { schema } from '../db/client';
import type { Mailer } from '../email/mailer';

/**
 * Authentication (ADR-0006).
 *
 * The addendum never mentions auth anywhere, so this whole area is
 * reconstructed. Magic link is the primary method because it and the
 * email-verification flow §E.3 already requires are the same mechanism --
 * one thing to build, not two.
 *
 * Sign in with Apple is deliberately absent: it needs a $99/yr Apple
 * Developer membership the user does not hold (OQ-1, closed). Providers are
 * additive, so adding it later touches no domain code.
 */

export interface AuthEnv {
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_BASE_URL: string;
}

/**
 * The origin this request actually arrived on.
 *
 * Configured APP_BASE_URL is the production origin, but in local development
 * the server is plain http on localhost. Deriving the base URL from the
 * request keeps two things correct that otherwise break silently:
 *
 *  - magic-link URLs point at the running server, not production;
 *  - cookies are only marked `Secure` over https. A `Secure` cookie issued
 *    over http is silently dropped by every browser, so sign-in appears to
 *    succeed and then the session simply does not exist.
 *
 * Only loopback origins are trusted to override; anything else uses the
 * configured value, so a spoofed Host header cannot redirect a magic link.
 */
export function resolveBaseUrl(configured: string, requestUrl: string): string {
  try {
    const origin = new URL(requestUrl).origin;
    const host = new URL(origin).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      return origin;
    }
  } catch {
    // Fall through to the configured value.
  }
  return configured;
}

export function createAuth(db: Database, env: AuthEnv, mailer: Mailer, requestUrl?: string) {
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const baseURL = requestUrl
    ? resolveBaseUrl(env.APP_BASE_URL, requestUrl)
    : env.APP_BASE_URL;

  return betterAuth({
    baseURL,
    basePath: '/api/v1/auth',
    secret: env.BETTER_AUTH_SECRET ?? 'dev-only-insecure-secret-do-not-deploy',

    database: drizzleAdapter(db, {
      provider: 'sqlite',
      // Our tables are plural; Better Auth's model names are singular.
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),

    // No passwords: there is nothing to leak, reset, or breach-check.
    emailAndPassword: { enabled: false },

    ...(googleConfigured
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID!,
              clientSecret: env.GOOGLE_CLIENT_SECRET!,
            },
          },
        }
      : {}),

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh at most daily
    },

    advanced: {
      // HttpOnly, SameSite cookies on a single origin (NFR-08, ADR-0004).
      // A service worker runs on this origin, so keeping the credential out
      // of JavaScript matters more here than usual.
      useSecureCookies: baseURL.startsWith('https://'),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
      },
    },

    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }) => {
          await mailer.send({
            to: email,
            subject: 'Your StockAlarm sign-in link',
            text: [
              'Use this link to sign in to StockAlarm:',
              '',
              url,
              '',
              'The link expires in 15 minutes and can only be used once.',
              'If you did not request it, you can ignore this email.',
            ].join('\n'),
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Which sign-in methods are actually usable, for the diagnostics surface. */
export function describeAuthMethods(env: AuthEnv, mailer: Mailer) {
  return {
    magicLink: {
      available: true,
      transport: mailer.name,
      /**
       * Whether a REAL transport is wired up -- not whether mail actually
       * arrives. A configured provider can still bounce every message when
       * its sending domain is unverified, so this must not be read as proof
       * of deliverability; it only rules out the console fallback, where
       * links are printed to the log and reach nobody.
       */
      transportConfigured: mailer.name !== 'console',
    },
    google: { available: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) },
    apple: { available: false, reason: 'Requires a paid Apple Developer account (OQ-1)' },
  };
}
