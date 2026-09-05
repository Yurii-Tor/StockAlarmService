import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { api, ApiError } from './api/client';
import type { Me } from './api/types';
import { Login } from './routes/Login';
import { Dashboard } from './routes/Dashboard';
import { AddInvestment } from './routes/AddInvestment';

/**
 * Session gate.
 *
 * The session is an HttpOnly cookie the page cannot read, so "am I signed in"
 * is answered by asking the server rather than by inspecting storage
 * (ADR-0004). A 401 is the signed-out state, not an error to display.
 */
export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out'>('loading');

  useEffect(() => {
    api
      .me()
      .then((value) => {
        setMe(value);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          setState('signed-out');
          return;
        }
        // Anything else is a real failure; treat it as signed out rather than
        // showing a blank screen, but do not pretend it was a clean logout.
        console.error('Session check failed', err);
        setState('signed-out');
      });
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-(--color-ink-muted)">
        Loading…
      </div>
    );
  }

  if (state === 'signed-out' || !me) {
    return <Login />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard me={me} />} />
        <Route path="/add" element={<AddInvestment />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
