'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);

    if (res && res.ok) {
      // A full navigation, so the server re-reads the new session cookie.
      window.location.href = '/mail';
      return;
    }
    const data = res ? await res.json().catch(() => null) : null;
    setError(data?.message ?? 'Could not sign in. Try again.');
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-soft px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-line bg-paper p-7 shadow-sm"
        >
          <h1 className="text-lg font-semibold text-ink">Sign in to school mail</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Use the account the office set up for you.
          </p>

          <label htmlFor="email" className="mt-6 mb-1.5 block text-xs font-semibold text-ink-soft">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink focus:border-crimson-500 focus:outline-none"
          />

          <label htmlFor="password" className="mt-4 mb-1.5 block text-xs font-semibold text-ink-soft">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink focus:border-crimson-500 focus:outline-none"
          />

          {error ? (
            <p className="mt-4 rounded-lg bg-crimson-50 px-3 py-2 text-sm text-crimson-800">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-crimson-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-crimson-600 disabled:opacity-50"
          >
            {busy ? 'Signing in' : 'Sign in'}
            {busy ? null : <Icon name="chevron-left" size={16} className="rotate-180" />}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-muted">
          P.O. Box 7513, Kampala
        </p>
      </div>
    </main>
  );
}
