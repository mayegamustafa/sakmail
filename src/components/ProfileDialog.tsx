'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { initialsOf } from '@/lib/client';
import type { Me } from '@/lib/types';

const inputCls =
  'w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-crimson-500 focus:outline-none';

/** Your own account: name, picture, and the password nobody could change before. */
export function ProfileDialog({
  me,
  onClose,
  onSaved,
}: {
  me: Me;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    firstName: me.firstName,
    lastName: me.lastName,
    avatarUrl: me.avatarUrl ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNote, setPwNote] = useState('');
  const [pwError, setPwError] = useState('');

  const mismatch = confirm.length > 0 && next !== confirm;

  async function saveProfile() {
    setSaving(true);
    setSaved('');
    setError('');
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).catch(() => null);
    setSaving(false);
    if (res && res.ok) {
      setSaved('Saved.');
      onSaved();
    } else {
      const data = res ? await res.json().catch(() => null) : null;
      setError(data?.message ?? 'Could not save.');
    }
  }

  async function changePassword() {
    setPwBusy(true);
    setPwNote('');
    setPwError('');
    const res = await fetch('/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setPwBusy(false);

    if (res && res.ok) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setPwNote(
        data?.otherSessionsEnded
          ? `Password changed. ${data.otherSessionsEnded} other session${data.otherSessionsEnded === 1 ? '' : 's'} signed out.`
          : 'Password changed.',
      );
    } else {
      setPwError(data?.message ?? 'Could not change it.');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-paper shadow-xl sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">My account</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-muted hover:bg-paper-dark"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <section>
            <div className="mb-4 flex items-center gap-3">
              {form.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-crimson-500 text-lg font-semibold text-white">
                  {initialsOf(me.firstName, me.lastName)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{me.email}</p>
                <p className="text-xs text-ink-muted">
                  {me.role === 'ADMIN' ? 'Administrator' : 'Staff'}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">First name</label>
                <input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Last name</label>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Picture</label>
              <input
                value={form.avatarUrl}
                onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })}
                placeholder="https://"
                className={inputCls}
              />
            </div>

            {error ? <p className="mt-3 text-sm text-crimson-700">{error}</p> : null}
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={saveProfile}
                disabled={saving || !form.firstName.trim() || !form.lastName.trim()}
                className="rounded-full bg-crimson-500 px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-600 disabled:opacity-50"
              >
                {saving ? 'Saving' : 'Save'}
              </button>
              {saved ? <span className="text-sm text-ink-soft">{saved}</span> : null}
            </div>
          </section>

          <section className="border-t border-line pt-5">
            <h3 className="text-sm font-semibold text-ink">Change password</h3>
            <p className="mt-1 text-xs text-ink-muted">
              Every other signed-in browser is signed out. This one stays.
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">
                  Current password
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink-soft">
                    New password
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink-soft">Confirm</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            {mismatch ? (
              <p className="mt-2 text-xs text-crimson-700">Those two do not match.</p>
            ) : null}
            {pwError ? <p className="mt-2 text-sm text-crimson-700">{pwError}</p> : null}
            {pwNote ? <p className="mt-2 text-sm text-ink-soft">{pwNote}</p> : null}

            <button
              type="button"
              onClick={changePassword}
              disabled={pwBusy || !current || next.length < 8 || next !== confirm}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-crimson-500 px-5 py-2 text-sm font-semibold text-crimson-700 hover:bg-crimson-50 disabled:opacity-50"
            >
              <Icon name="shield" size={15} /> {pwBusy ? 'Changing' : 'Change password'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
