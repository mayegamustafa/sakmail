'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Field } from '@/components/MailClient';
import { api, initialsOf } from '@/lib/client';
import type { Mailbox, MailboxMember, StaffAccount } from '@/lib/types';

type Tab = 'addresses' | 'staff' | 'setup';

/** Addresses, the people who work in them, and how mail gets in and out. */
export function AdminPanel({
  mailboxes,
  onClose,
  onChanged,
}: {
  mailboxes: Mailbox[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('addresses');

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/40 sm:items-center sm:p-4">
      <div className="flex h-full w-full max-w-4xl flex-col border border-line bg-paper shadow-xl sm:h-[88vh] sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1 rounded-full border border-line bg-paper-soft p-1">
            {(
              [
                ['addresses', 'Addresses'],
                ['staff', 'Staff'],
                ['setup', 'Setup'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={[
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  tab === key ? 'bg-crimson-500 text-white' : 'text-ink-soft hover:text-crimson-700',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-ink-muted hover:bg-paper-dark"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {tab === 'addresses' ? (
            <Addresses mailboxes={mailboxes} onChanged={onChanged} />
          ) : tab === 'staff' ? (
            <StaffTab onChanged={onChanged} />
          ) : (
            <Setup mailboxCount={mailboxes.length} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Addresses ────────────────────────────────────────────────────────────────

const EMPTY: Partial<Mailbox> = {
  address: '',
  displayName: 'Sir Apollo Kaggwa Schools',
  description: '',
  isCatchAll: false,
  isActive: true,
  signature: '',
  autoReplyEnabled: false,
};

const inputCls =
  'w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-crimson-500 focus:outline-none';

function Addresses({ mailboxes, onChanged }: { mailboxes: Mailbox[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Partial<Mailbox> | null>(null);
  const [members, setMembers] = useState<MailboxMember[]>([]);
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<StaffAccount[]>('/api/users').then((r) => setStaff(r ?? []));
  }, []);

  function open(mailbox: Partial<Mailbox>) {
    setEditing(mailbox);
    setMembers(mailbox.members ?? []);
    setError('');
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError('');

    const isNew = !editing.id;
    const res = await fetch(isNew ? '/api/mailboxes' : `/api/mailboxes/${editing.id}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    }).catch(() => null);

    if (!res || !res.ok) {
      setSaving(false);
      const data = res ? await res.json().catch(() => null) : null;
      setError(data?.message ?? 'Could not save this address.');
      return;
    }

    // A new address has no id until it is saved, so who may use it is written
    // in a second call once the id exists.
    const saved = (await res.json()) as Mailbox;
    const memberRes = await fetch(`/api/mailboxes/${saved.id}/members`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        members: members.map((m) => ({ userId: m.userId, canSend: m.canSend })),
      }),
    }).catch(() => null);

    setSaving(false);
    if (!memberRes || !memberRes.ok) {
      setError('The address was saved, but who may use it was not. Try that part again.');
      onChanged();
      return;
    }
    setEditing(null);
    onChanged();
  }

  async function remove(m: Mailbox) {
    if (!confirm(`Delete ${m.address}? Every conversation in it is deleted too.`)) return;
    await fetch(`/api/mailboxes/${m.id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-soft">
          Each address receives mail as soon as the domain points at this portal. Adding another one
          needs no DNS change.
        </p>
        <button
          type="button"
          onClick={() => open({ ...EMPTY })}
          className="inline-flex items-center gap-1.5 rounded-full bg-crimson-500 px-4 py-2 text-sm font-semibold text-white hover:bg-crimson-600"
        >
          <Icon name="plus" size={16} /> New address
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {mailboxes.map((m) => (
          <div key={m.id} className="rounded-xl border border-line bg-paper-soft p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{m.address}</p>
                <p className="truncate text-xs text-ink-muted">{m.displayName}</p>
              </div>
              <div className="flex shrink-0 gap-0.5">
                <button
                  onClick={() => open(m)}
                  aria-label="Edit"
                  className="rounded-lg p-2 text-ink-muted hover:bg-paper-dark hover:text-ink"
                >
                  <Icon name="edit" size={16} />
                </button>
                <button
                  onClick={() => remove(m)}
                  aria-label="Delete"
                  className="rounded-lg p-2 text-ink-muted hover:bg-crimson-50 hover:text-crimson-700"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {m.isCatchAll ? (
                <span className="rounded bg-crimson-100 px-2 py-0.5 text-[11px] font-semibold text-crimson-800">
                  Catch-all
                </span>
              ) : null}
              {m.autoReplyEnabled ? (
                <span className="rounded bg-paper-dark px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                  Auto-reply
                </span>
              ) : null}
              <span
                className={[
                  'rounded px-2 py-0.5 text-[11px] font-semibold',
                  m.isActive ? 'bg-paper-dark text-ink-soft' : 'bg-crimson-100 text-crimson-800',
                ].join(' ')}
              >
                {m.isActive ? 'Active' : 'Paused'}
              </span>
            </div>

            {m.members?.length ? (
              <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
                {m.members
                  .slice(0, 3)
                  .map((mem) => mem.user?.firstName ?? 'Someone')
                  .join(', ')}
                {m.members.length > 3 ? ` and ${m.members.length - 3} more` : ''}
              </p>
            ) : (
              <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
                Only administrators can see this address.
              </p>
            )}
          </div>
        ))}
        {mailboxes.length === 0 ? (
          <p className="text-sm text-ink-muted">No addresses yet. Create the first one.</p>
        ) : null}
      </div>

      {editing ? (
        <Dialog
          title={editing.id ? 'Edit address' : 'New address'}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
          canSave={Boolean(editing.address?.trim() && editing.displayName?.trim())}
        >
          <Field label="Address" hint="For example kisaasi@sirapollokaggwaschools.co.ug">
            <input
              value={editing.address ?? ''}
              onChange={(e) => setEditing({ ...editing, address: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Display name" hint="The name people see on replies">
            <input
              value={editing.displayName ?? ''}
              onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Sender picture" hint="Shown at the top of every message this address sends. Paste an https image URL.">
            <input
              value={editing.avatarUrl ?? ''}
              onChange={(e) => setEditing({ ...editing, avatarUrl: e.target.value })}
              placeholder="https://"
              className={inputCls}
            />
          </Field>
          <Field label="Signature" hint="Added to the bottom of every reply from here">
            <textarea
              rows={3}
              value={editing.signature ?? ''}
              onChange={(e) => setEditing({ ...editing, signature: e.target.value })}
              className={inputCls}
            />
          </Field>

          <Toggle
            label="Receive mail for any unmatched address"
            checked={Boolean(editing.isCatchAll)}
            onChange={(v) => setEditing({ ...editing, isCatchAll: v })}
          />
          <Toggle
            label="Active"
            checked={editing.isActive !== false}
            onChange={(v) => setEditing({ ...editing, isActive: v })}
          />
          <Toggle
            label="Send an automatic acknowledgement"
            checked={Boolean(editing.autoReplyEnabled)}
            onChange={(v) => setEditing({ ...editing, autoReplyEnabled: v })}
          />
          {editing.autoReplyEnabled ? (
            <>
              <Field label="Auto-reply subject">
                <input
                  value={editing.autoReplySubject ?? ''}
                  onChange={(e) => setEditing({ ...editing, autoReplySubject: e.target.value })}
                  placeholder="We received your message"
                  className={inputCls}
                />
              </Field>
              <Field label="Auto-reply message" hint="Sent once, only on the first message of a conversation">
                <textarea
                  rows={4}
                  value={editing.autoReplyBody ?? ''}
                  onChange={(e) => setEditing({ ...editing, autoReplyBody: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </>
          ) : null}

          <div className="border-t border-line pt-3">
            <p className="mb-1 text-xs font-semibold text-ink-soft">Who works in this address</p>
            <p className="mb-2 text-xs text-ink-muted">
              Administrators always have access. Anyone ticked here sees this address and nothing
              else.
            </p>
            <div className="space-y-1.5">
              {staff.filter((s) => s.role !== 'ADMIN').length === 0 ? (
                <p className="text-xs text-ink-muted">
                  No staff accounts yet. Create them under the Staff tab.
                </p>
              ) : (
                staff
                  .filter((s) => s.role !== 'ADMIN')
                  .map((person) => {
                    const member = members.find((m) => m.userId === person.id);
                    return (
                      <div
                        key={person.id}
                        className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(member)}
                          onChange={(e) =>
                            setMembers((prev) =>
                              e.target.checked
                                ? [...prev, { userId: person.id, canSend: true }]
                                : prev.filter((m) => m.userId !== person.id),
                            )
                          }
                          aria-label={`Give ${person.firstName} access`}
                          className="h-4 w-4 rounded border-line text-crimson-500"
                        />
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-paper-dark text-[10px] font-semibold text-ink-soft">
                          {initialsOf(person.firstName, person.lastName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">
                            {person.firstName} {person.lastName}
                          </span>
                          <span className="block truncate text-xs text-ink-muted">{person.email}</span>
                        </span>
                        {member ? (
                          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                            <input
                              type="checkbox"
                              checked={member.canSend}
                              onChange={(e) =>
                                setMembers((prev) =>
                                  prev.map((m) =>
                                    m.userId === person.id ? { ...m, canSend: e.target.checked } : m,
                                  ),
                                )
                              }
                              className="h-3.5 w-3.5 rounded border-line text-crimson-500"
                            />
                            Can send
                          </label>
                        ) : null}
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {error ? <p className="text-sm text-crimson-700">{error}</p> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

// ── Staff ────────────────────────────────────────────────────────────────────

function StaffTab({ onChanged }: { onChanged: () => void }) {
  const [people, setPeople] = useState<StaffAccount[]>([]);
  const [editing, setEditing] = useState<(Partial<StaffAccount> & { password?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setPeople((await api<StaffAccount[]>('/api/users')) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError('');
    const isNew = !editing.id;
    const res = await fetch(isNew ? '/api/users' : `/api/users/${editing.id}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    }).catch(() => null);
    setSaving(false);

    if (res && res.ok) {
      setEditing(null);
      await load();
      onChanged();
    } else {
      const data = res ? await res.json().catch(() => null) : null;
      setError(data?.message ?? 'Could not save.');
    }
  }

  async function setPassword(person: StaffAccount) {
    const password = window.prompt(`New password for ${person.firstName} (at least 8 characters)`);
    if (!password) return;
    const res = await fetch(`/api/users/${person.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    alert(
      res && res.ok
        ? 'Password set. They are signed out everywhere and must sign in again.'
        : (data?.message ?? 'Could not set it.'),
    );
  }

  async function remove(person: StaffAccount) {
    if (!confirm(`Remove ${person.firstName} ${person.lastName}? They lose access immediately.`)) return;
    const res = await fetch(`/api/users/${person.id}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.ok) {
      await load();
      onChanged();
    } else {
      const data = res ? await res.json().catch(() => null) : null;
      alert(data?.message ?? 'Could not remove this account.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-soft">
          Accounts that can sign in. A staff account sees only the addresses it has been given.
        </p>
        <button
          type="button"
          onClick={() => setEditing({ role: 'STAFF', isActive: true })}
          className="inline-flex items-center gap-1.5 rounded-full bg-crimson-500 px-4 py-2 text-sm font-semibold text-white hover:bg-crimson-600"
        >
          <Icon name="plus" size={16} /> New account
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {people.map((p) => (
          <div key={p.id} className="rounded-xl border border-line bg-paper-soft p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-crimson-500 text-xs font-semibold text-white">
                  {initialsOf(p.firstName, p.lastName)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">
                    {p.firstName} {p.lastName}
                  </p>
                  <p className="truncate text-xs text-ink-muted">{p.email}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-0.5">
                <button
                  onClick={() => setEditing(p)}
                  aria-label="Edit"
                  className="rounded-lg p-2 text-ink-muted hover:bg-paper-dark hover:text-ink"
                >
                  <Icon name="edit" size={16} />
                </button>
                <button
                  onClick={() => setPassword(p)}
                  aria-label="Set password"
                  title="Set password"
                  className="rounded-lg p-2 text-ink-muted hover:bg-paper-dark hover:text-ink"
                >
                  <Icon name="shield" size={16} />
                </button>
                <button
                  onClick={() => remove(p)}
                  aria-label="Remove"
                  className="rounded-lg p-2 text-ink-muted hover:bg-crimson-50 hover:text-crimson-700"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded bg-paper-dark px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                {p.role === 'ADMIN' ? 'Administrator' : 'Staff'}
              </span>
              {p.mailboxAccess?.length ? (
                <span className="rounded bg-crimson-100 px-2 py-0.5 text-[11px] font-semibold text-crimson-800">
                  {p.mailboxAccess.length} address{p.mailboxAccess.length > 1 ? 'es' : ''}
                </span>
              ) : null}
              {p.isActive ? null : (
                <span className="rounded bg-crimson-100 px-2 py-0.5 text-[11px] font-semibold text-crimson-800">
                  Suspended
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing ? (
        <Dialog
          title={editing.id ? 'Edit account' : 'New account'}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
          canSave={Boolean(
            editing.firstName?.trim() &&
              editing.lastName?.trim() &&
              (editing.id || (editing.email?.trim() && (editing.password ?? '').length >= 8)),
          )}
        >
          {editing.id ? (
            <p className="text-sm text-ink-soft">{editing.email}</p>
          ) : (
            <>
              <Field label="Email" hint="They sign in with this">
                <input
                  value={editing.email ?? ''}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Temporary password" hint="At least 8 characters">
                <input
                  value={editing.password ?? ''}
                  onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name">
              <input
                value={editing.firstName ?? ''}
                onChange={(e) => setEditing({ ...editing, firstName: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Last name">
              <input
                value={editing.lastName ?? ''}
                onChange={(e) => setEditing({ ...editing, lastName: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Phone">
            <input
              value={editing.phone ?? ''}
              onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Toggle
            label="Administrator: manages addresses, staff and access, and sees every address"
            checked={editing.role === 'ADMIN'}
            onChange={(v) => setEditing({ ...editing, role: v ? 'ADMIN' : 'STAFF' })}
          />
          {editing.id ? (
            <Toggle
              label="Active"
              checked={editing.isActive !== false}
              onChange={(v) => setEditing({ ...editing, isActive: v })}
            />
          ) : null}
          {error ? <p className="text-sm text-crimson-700">{error}</p> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

function Setup({ mailboxCount }: { mailboxCount: number }) {
  const [status, setStatus] = useState<{
    inboundReady: boolean;
    sendingReady: boolean;
    sendingError?: string;
    webhookUrl: string | null;
  } | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<typeof status>('/api/setup').then(setStatus);
  }, []);

  async function rotate() {
    if (
      status?.inboundReady &&
      !confirm('Generate a new secret? The Worker must be updated with it or mail stops arriving.')
    ) {
      return;
    }
    setBusy(true);
    const data = await api<{ secret: string }>('/api/setup/secret', { method: 'POST' });
    setBusy(false);
    if (data?.secret) {
      setSecret(data.secret);
      setStatus((s) => (s ? { ...s, inboundReady: true } : s));
    }
  }

  const receiving = !status?.inboundReady
    ? 'Not set up'
    : mailboxCount === 0
      ? 'No addresses yet'
      : 'Ready';

  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Addresses" value={String(mailboxCount)} ok={mailboxCount > 0} />
        <Tile label="Receiving" value={receiving} ok={Boolean(status?.inboundReady) && mailboxCount > 0} />
        <Tile
          label="Sending"
          value={status?.sendingReady ? 'Ready' : 'Not connected'}
          ok={Boolean(status?.sendingReady)}
        />
      </div>

      {status && status.inboundReady && mailboxCount === 0 ? (
        <p className="rounded-xl border border-crimson-200 bg-crimson-50 p-4 text-sm text-crimson-900">
          The webhook is connected, but no addresses exist, so there is nothing to deliver mail to.
          Anything sent right now is bounced back to the sender.
        </p>
      ) : null}

      <section className="rounded-xl border border-line bg-paper-soft p-5">
        <h2 className="text-base font-semibold text-ink">Connect incoming mail</h2>
        <ol className="mt-3 space-y-4 text-sm text-ink-soft">
          <li>
            <p className="font-semibold text-ink">1. Generate the webhook secret</p>
            <p className="mt-1">This portal only accepts mail from a caller holding this secret.</p>
            <button
              type="button"
              onClick={rotate}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-crimson-500 px-4 py-1.5 text-sm font-semibold text-crimson-700 hover:bg-crimson-50 disabled:opacity-50"
            >
              <Icon name="refresh" size={15} />
              {status?.inboundReady ? 'Generate a new secret' : 'Generate secret'}
            </button>
            {secret ? (
              <div className="mt-2 rounded-xl border border-crimson-300 bg-crimson-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-crimson-800">
                  Copy this now, it is shown once
                </p>
                <code className="mt-1 block break-all font-mono text-sm text-ink">{secret}</code>
              </div>
            ) : null}
          </li>
          <li>
            <p className="font-semibold text-ink">2. Point Cloudflare Email Routing here</p>
            <code className="mt-1 block break-all rounded-lg bg-paper-dark px-3 py-2 font-mono text-xs text-ink">
              {status?.webhookUrl ?? 'Set PUBLIC_URL so this can be shown'}
            </code>
            <p className="mt-1">
              Create a Worker with the code in docs/cloudflare-email-worker.js, set
              PORTAL_WEBHOOK_URL and PORTAL_SECRET on it, then route each address to that Worker.
            </p>
          </li>
          <li>
            <p className="font-semibold text-ink">3. Connect sending</p>
            <p className="mt-1">
              Replies leave through Brevo over HTTPS. Set BREVO_API_KEY on the service.
              {status?.sendingError ? ` Currently: ${status.sendingError}` : ''}
            </p>
          </li>
        </ol>
      </section>
    </div>
  );
}

function Tile({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{label}</p>
      <p className={['mt-1 text-lg font-semibold', ok ? 'text-ink' : 'text-ink-muted'].join(' ')}>
        {value}
      </p>
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────

function Dialog({
  title,
  children,
  onClose,
  onSave,
  saving,
  canSave,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-paper shadow-xl sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-muted hover:bg-paper-dark"
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">{children}</div>
        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-ink-muted hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !canSave}
            className="rounded-full bg-crimson-500 px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-600 disabled:opacity-50"
          >
            {saving ? 'Saving' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-line text-crimson-500"
      />
      {label}
    </label>
  );
}
