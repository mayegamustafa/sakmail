'use client';

import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';

/**
 * The first administrator, created in the browser rather than from a seed.
 *
 * A seeded password is only knowable if you saw the variable at the moment it
 * first ran, and it cannot be changed afterwards without wiping credentials on
 * every redeploy. Typing it here removes that whole class of problem.
 */
export function FirstRunSetup() {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: 'admin@sirapollokaggwaschools.co.ug',
    password: '',
    confirm: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mismatch = form.confirm.length > 0 && form.password !== form.confirm;
  const ready =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    form.password.length >= 8 &&
    form.password === form.confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    const res = await fetch('/api/setup/first-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
      }),
    }).catch(() => null);

    if (res && res.ok) {
      // A full navigation, so the server reads the session cookie just set.
      window.location.href = '/mail';
      return;
    }
    const data = res ? await res.json().catch(() => null) : null;
    setError(data?.message ?? 'Could not create the account. Try again.');
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-soft px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-line bg-paper p-7 shadow-sm">
          <h1 className="text-lg font-semibold text-ink">Set up school mail</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Nobody administers this install yet. Create the first account and you will be signed in.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="first" className="mb-1.5 block text-xs font-semibold text-ink-soft">
                First name
              </label>
              <input
                id="first"
                required
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="last" className="mb-1.5 block text-xs font-semibold text-ink-soft">
                Last name
              </label>
              <input
                id="last"
                required
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          <label htmlFor="email" className="mt-4 mb-1.5 block text-xs font-semibold text-ink-soft">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-ink-muted">This is what you will sign in with.</p>

          <label htmlFor="password" className="mt-4 mb-1.5 block text-xs font-semibold text-ink-soft">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-ink-muted">At least 8 characters.</p>

          <label htmlFor="confirm" className="mt-4 mb-1.5 block text-xs font-semibold text-ink-soft">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            className={inputCls}
          />
          {mismatch ? (
            <p className="mt-1 text-xs text-crimson-700">Those two do not match.</p>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-lg bg-crimson-50 px-3 py-2 text-sm text-crimson-800">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={busy || !ready}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-crimson-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-crimson-600 disabled:opacity-50"
          >
            {busy ? 'Creating' : 'Create account and sign in'}
            {busy ? null : <Icon name="check" size={16} />}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-muted">
          This page closes as soon as one administrator exists.
        </p>
      </div>
    </main>
  );
}

const inputCls =
  'w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink focus:border-crimson-500 focus:outline-none';
