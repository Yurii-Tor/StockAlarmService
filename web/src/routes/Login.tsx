import { useState } from 'react';
import { api, googleSignInUrl } from '../api/client';

/**
 * Sign-in (ADR-0006).
 *
 * Magic link is primary; Google exists because it is the one route that does
 * not depend on email deliverability. If mail is broken, magic-link sign-in
 * fails silently from the user's point of view -- they simply never receive
 * anything -- so a second door matters more here than it usually would.
 */
export function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signInWithMagicLink(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-semibold">StockAlarm</h1>
      <p className="mt-1 mb-8 text-sm text-(--color-ink-muted)">
        Record why you bought something, and be reminded to revisit it.
      </p>

      {sent ? (
        <div data-testid="magic-link-sent" className="rounded-xl border border-(--color-border-subtle) bg-(--color-surface-raised) p-4">
          <p className="text-sm font-medium">Check your email</p>
          <p className="mt-1 text-xs text-(--color-ink-muted)">
            A sign-in link is on its way to {email}. It expires in 15 minutes and works once.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            data-testid="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-(--color-border-subtle) bg-(--color-surface-raised) px-4 py-3 text-base outline-none focus:border-(--color-accent)"
          />
          <button
            type="submit"
            data-testid="send-link"
            disabled={busy}
            className="w-full rounded-xl bg-(--color-accent) px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Sending…' : 'Email me a sign-in link'}
          </button>
          {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        </form>
      )}

      <div className="my-6 flex items-center gap-3 text-xs text-(--color-ink-muted)">
        <span className="h-px flex-1 bg-(--color-border-subtle)" />
        or
        <span className="h-px flex-1 bg-(--color-border-subtle)" />
      </div>

      <a
        href={googleSignInUrl()}
        data-testid="google-signin"
        className="rounded-xl border border-(--color-border-subtle) bg-(--color-surface-raised) px-4 py-3 text-center text-sm font-medium"
      >
        Continue with Google
      </a>
    </main>
  );
}
