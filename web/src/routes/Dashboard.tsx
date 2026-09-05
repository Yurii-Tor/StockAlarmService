import { Link } from 'react-router';
import type { Me } from '../api/types';

export function Dashboard({ me }: { me: Me }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold">Portfolio</h1>
        <p className="text-xs text-(--color-ink-muted)">{me.user.email}</p>
      </header>

      <Link
        to="/add"
        data-testid="add-investment"
        className="block rounded-xl bg-(--color-accent) px-4 py-3 text-center text-sm font-semibold text-white"
      >
        Add an investment
      </Link>

      <section className="mt-8 rounded-xl border border-dashed border-(--color-border-subtle) p-6 text-center">
        <p className="text-sm text-(--color-ink-muted)">
          Nothing saved yet. Persistence arrives in the next phase — for now the add flow runs
          end to end up to the point of saving.
        </p>
      </section>
    </main>
  );
}
