'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { AdminPanel } from '@/components/AdminPanel';
import { ProfileDialog } from '@/components/ProfileDialog';
import type { Me, Mailbox, ThreadSummary, ThreadDetail, Counts, Staff, Attachment } from '@/lib/types';
import { api, formatWhen, formatBytes, initialsOf } from '@/lib/client';
import { useLive } from '@/lib/live';
import { SwipeRow } from '@/components/SwipeRow';
import { printDocument, sheetHead, escapeHtml } from '@/lib/print';

const VIEWS: { key: string; label: string; icon: IconName; noCount?: boolean }[] = [
  { key: 'inbox', label: 'Inbox', icon: 'inbox' },
  // Sent always shows, never counts: it is a record of what has gone out, not a
  // queue of things waiting, so a number on it only ever grows and means nothing.
  { key: 'sent', label: 'Sent', icon: 'send', noCount: true },
  { key: 'starred', label: 'Starred', icon: 'star' },
  { key: 'archived', label: 'Archived', icon: 'archive' },
  { key: 'spam', label: 'Spam', icon: 'shield' },
  { key: 'trash', label: 'Trash', icon: 'trash' },
];

export function MailClient({ me }: { me: Me }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);

  const [view, setView] = useState('inbox');
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  // Long press opens selection, the way a phone mail app does. Empty means off.
  const [selected, setSelected] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(me);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadShell = useCallback(async () => {
    const [boxes, c, s] = await Promise.all([
      api<Mailbox[]>('/api/mailboxes'),
      api<Counts>('/api/counts'),
      api<Staff[]>('/api/staff'),
    ]);
    if (boxes) setMailboxes(boxes);
    if (c) setCounts(c);
    if (s) setStaff(s);
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (mailboxId) p.set('mailboxId', mailboxId);
    if (debounced) p.set('search', debounced);
    if (view === 'starred') p.set('starred', 'true');
    else if (view === 'sent') p.set('sent', 'true');
    else if (view === 'archived') p.set('state', 'ARCHIVED');
    else if (view === 'spam') p.set('state', 'SPAM');
    else if (view === 'trash') p.set('state', 'TRASH');
    else p.set('state', 'OPEN');
    return p.toString();
  }, [mailboxId, debounced, view]);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    const data = await api<{ items: ThreadSummary[]; total: number }>(`/api/threads?${query}`);
    setThreads(data?.items ?? []);
    setTotal(data?.total ?? 0);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const refresh = useCallback(() => {
    void loadThreads();
    void loadShell();
  }, [loadThreads, loadShell]);

  /**
   * Applies an action to one or many conversations.
   *
   * The rows disappear from the list immediately rather than after the round
   * trip, because on a phone a swipe that leaves the row sitting there reads as
   * having failed.
   */
  const act = useCallback(
    async (ids: string[], change: Record<string, unknown> | 'delete') => {
      if (!ids.length) return;
      setThreads((prev) => prev.filter((t) => !ids.includes(t.id)));
      setSelected([]);
      if (openId && ids.includes(openId)) setOpenId(null);

      await Promise.all(
        ids.map((id) =>
          change === 'delete'
            ? api(`/api/threads/${id}`, { method: 'DELETE' })
            : api(`/api/threads/${id}`, { method: 'PATCH', body: JSON.stringify(change) }),
        ),
      );
      refresh();
    },
    [openId, refresh],
  );

  function toggleSelected(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /**
   * New mail appears on its own. The list and the folder counts refresh; an open
   * conversation is deliberately left alone, since replacing what somebody is
   * reading mid-sentence is worse than showing it a few seconds late.
   */
  const refreshQuietly = useCallback(async () => {
    const [data, c] = await Promise.all([
      api<{ items: ThreadSummary[]; total: number }>(`/api/threads?${query}`),
      api<Counts>('/api/counts'),
    ]);
    if (data) {
      setThreads(data.items);
      setTotal(data.total);
    }
    if (c) setCounts(c);
  }, [query]);

  useLive(refreshQuietly);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/sign-in';
  }

  const badgeFor = (key: string) =>
    key === 'inbox'
      ? counts?.totalUnread
      : key === 'sent'
        ? counts?.sent
        : key === 'starred'
          ? counts?.starred
          : key === 'archived'
            ? counts?.archived
            : key === 'spam'
              ? counts?.spam
              : counts?.trash;

  return (
    <div className="flex h-screen flex-col bg-paper-soft">
      {/* Topbar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-paper px-3 sm:px-4">
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Folders"
          className="rounded-lg p-2 text-ink-soft hover:bg-paper-dark lg:hidden"
        >
          <Icon name="menu" />
        </button>
        <Logo />

        <div className="relative ml-auto hidden max-w-md flex-1 sm:block">
          <Icon
            name="search"
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search mail"
            aria-label="Search mail"
            className="w-full rounded-full border border-line bg-paper-soft py-2 pl-9 pr-4 text-sm focus:border-crimson-500 focus:bg-paper focus:outline-none"
          />
        </div>

        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          {me.role === 'ADMIN' ? (
            <button
              type="button"
              onClick={() => setAdminOpen(true)}
              title="Addresses and staff"
              aria-label="Addresses and staff"
              className="rounded-lg p-2 text-ink-soft hover:bg-paper-dark"
            >
              <Icon name="settings" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            title={`${profile.firstName} ${profile.lastName}, my account`}
            aria-label="My account"
            className="ml-1 rounded-full transition-opacity hover:opacity-80"
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-crimson-500 text-xs font-semibold text-white">
                {initialsOf(profile.firstName, profile.lastName)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-2 text-ink-soft hover:bg-paper-dark"
          >
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Folders */}
        <aside
          className={[
            'w-60 shrink-0 overflow-y-auto border-r border-line bg-paper p-3',
            navOpen ? 'absolute inset-y-14 left-0 z-30 shadow-lg' : 'hidden',
            'lg:static lg:block lg:shadow-none',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={() => {
              setComposing(true);
              setNavOpen(false);
            }}
            disabled={mailboxes.length === 0}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-crimson-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-crimson-600 disabled:opacity-40"
          >
            <Icon name="edit" size={17} /> Compose
          </button>

          <nav className="space-y-0.5" aria-label="Folders">
            {VIEWS.map((v) => {
              const badge = v.noCount ? undefined : badgeFor(v.key);
              const active = view === v.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => {
                    setView(v.key);
                    setOpenId(null);
                    setNavOpen(false);
                  }}
                  className={[
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    active
                      ? 'bg-crimson-50 font-semibold text-crimson-800'
                      : 'text-ink-soft hover:bg-paper-dark',
                  ].join(' ')}
                >
                  <Icon name={v.icon} size={18} />
                  <span className="flex-1 text-left">{v.label}</span>
                  {badge ? (
                    <span className="rounded-full bg-crimson-500 px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-white">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <p className="mt-6 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            Addresses
          </p>
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => setMailboxId(null)}
              className={[
                'w-full truncate rounded-lg px-3 py-1.5 text-left text-sm',
                mailboxId === null ? 'bg-paper-dark font-medium text-ink' : 'text-ink-soft hover:bg-paper-dark',
              ].join(' ')}
            >
              All addresses
            </button>
            {mailboxes.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMailboxId(m.id);
                  setNavOpen(false);
                }}
                title={m.address}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm',
                  mailboxId === m.id ? 'bg-paper-dark font-medium text-ink' : 'text-ink-soft hover:bg-paper-dark',
                ].join(' ')}
              >
                <span className="min-w-0 flex-1 truncate">{m.address.split('@')[0]}</span>
                {counts?.unread?.[m.id] ? (
                  <span className="shrink-0 text-[11px] font-semibold text-crimson-700">
                    {counts.unread[m.id]}
                  </span>
                ) : null}
              </button>
            ))}
            {mailboxes.length === 0 ? (
              <p className="px-3 py-2 text-xs text-ink-muted">
                No addresses assigned to you yet.
              </p>
            ) : null}
          </div>
        </aside>

        {/* Conversation list */}
        <section
          className={[
            'flex min-w-0 flex-col border-r border-line bg-paper',
            openId ? 'hidden md:flex md:w-80 lg:w-96' : 'flex-1 md:w-80 md:flex-none lg:w-96',
          ].join(' ')}
        >
          {selected.length ? (
            <div className="flex items-center gap-1 border-b border-line bg-crimson-50 px-2 py-2">
              <button
                type="button"
                onClick={() => setSelected([])}
                aria-label="Cancel selection"
                className="rounded-lg p-2 text-ink-soft hover:bg-white"
              >
                <Icon name="close" size={18} />
              </button>
              <span className="text-sm font-semibold text-crimson-800">{selected.length}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => act(selected, { isRead: true })}
                  title="Mark read"
                  aria-label="Mark read"
                  className="rounded-lg p-2 text-ink-soft hover:bg-white"
                >
                  <Icon name="check" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => act(selected, { isStarred: true })}
                  title="Star"
                  aria-label="Star"
                  className="rounded-lg p-2 text-ink-soft hover:bg-white"
                >
                  <Icon name="star" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => act(selected, { state: 'ARCHIVED' })}
                  title="Archive"
                  aria-label="Archive"
                  className="rounded-lg p-2 text-ink-soft hover:bg-white"
                >
                  <Icon name="archive" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => act(selected, { state: 'SPAM' })}
                  title="Mark spam"
                  aria-label="Mark spam"
                  className="rounded-lg p-2 text-ink-soft hover:bg-white"
                >
                  <Icon name="shield" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete ${selected.length} conversation${selected.length === 1 ? '' : 's'}? This cannot be undone.`)) {
                      void act(selected, 'delete');
                    }
                  }}
                  title="Delete"
                  aria-label="Delete"
                  className="rounded-lg p-2 text-ink-muted hover:bg-white hover:text-crimson-700"
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </div>
          ) : null}

          <div className="border-b border-line p-2 sm:hidden">
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mail"
                aria-label="Search mail"
                className="w-full rounded-full border border-line bg-paper-soft py-2 pl-9 pr-3 text-sm focus:border-crimson-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-5 text-sm text-ink-muted">Loading</p>
            ) : threads.length === 0 ? (
              <p className="p-5 text-sm text-ink-muted">
                {debounced
                  ? 'Nothing matches that search.'
                  : view === 'sent'
                    ? 'Nothing has been sent from these addresses yet.'
                    : 'No conversations here.'}
              </p>
            ) : (
              <>
              <p className="border-b border-line bg-paper-soft px-3 py-1.5 text-[11px] text-ink-muted md:hidden">
                Swipe a conversation to archive or delete it. Hold one to select several.
              </p>
              <ul>
                {threads.map((t) => (
                  <li key={t.id}>
                  <SwipeRow
                    left={{ label: 'Archive', icon: 'archive', tone: 'positive' }}
                    right={{ label: 'Delete', icon: 'trash', tone: 'danger' }}
                    onLeft={() => act([t.id], { state: 'ARCHIVED' })}
                    onRight={() => act([t.id], 'delete')}
                    onHold={() => toggleSelected(t.id)}
                    disabled={selected.length > 0}
                  >
                    <button
                      type="button"
                      onClick={() => (selected.length ? toggleSelected(t.id) : setOpenId(t.id))}
                      className={[
                        'flex w-full gap-3 border-b border-line/70 px-3 py-3 text-left transition-colors',
                        selected.includes(t.id)
                          ? 'bg-crimson-50'
                          : openId === t.id
                            ? 'bg-crimson-50/60'
                            : 'hover:bg-paper-soft',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                          selected.includes(t.id)
                            ? 'bg-crimson-600 text-white'
                            : t.isRead
                              ? 'bg-paper-dark text-ink-soft'
                              : 'bg-crimson-500 text-white',
                        ].join(' ')}
                      >
                        {selected.includes(t.id) ? (
                          <Icon name="check" size={16} />
                        ) : (
                          initialsOf(t.participantName ?? t.participant)
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={[
                              'truncate text-sm',
                              t.isRead ? 'text-ink-soft' : 'font-semibold text-ink',
                            ].join(' ')}
                          >
                            {t.participantName || t.participant}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-muted">
                            {formatWhen(t.lastMessageAt)}
                          </span>
                        </span>
                        <span
                          className={[
                            'mt-0.5 block truncate text-sm',
                            t.isRead ? 'text-ink-soft' : 'font-medium text-ink',
                          ].join(' ')}
                        >
                          {t.subject}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-muted">{t.snippet}</span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-paper-dark px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
                            {t.mailbox.address.split('@')[0]}
                          </span>
                          {t.messageCount > 1 ? (
                            <span className="text-[10px] text-ink-muted">{t.messageCount} messages</span>
                          ) : null}
                          {t.hasAttachments ? <Icon name="paperclip" size={11} className="text-ink-muted" /> : null}
                          {t.isStarred ? <Icon name="star" size={11} className="text-crimson-500" /> : null}
                          {t.assignedTo ? (
                            <span className="rounded bg-crimson-50 px-1.5 py-0.5 text-[10px] font-medium text-crimson-800">
                              {t.assignedTo.firstName}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </SwipeRow>
                </li>
                ))}
              </ul>
              </>
            )}
          </div>

          {total > threads.length ? (
            <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
              Showing {threads.length} of {total}. Narrow it with search.
            </p>
          ) : null}
        </section>

        {/* Conversation */}
        <section className={['min-w-0 flex-1', openId ? 'flex' : 'hidden md:flex'].join(' ')}>
          {openId ? (
            <ThreadView
              key={openId}
              threadId={openId}
              staff={staff}
              onChanged={refresh}
              onClose={() => setOpenId(null)}
            />
          ) : (
            <div className="flex w-full items-center justify-center p-8 text-center">
              <div>
                <Icon name="at" size={28} className="mx-auto text-crimson-300" />
                <p className="mt-3 text-sm text-ink-muted">Select a conversation to read it.</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {composing ? (
        <ComposeDialog
          mailboxes={mailboxes.filter((m) => m.isActive)}
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            refresh();
          }}
        />
      ) : null}

      {profileOpen ? (
        <ProfileDialog
          me={profile}
          onClose={() => setProfileOpen(false)}
          onSaved={() => {
            void fetch('/api/me')
              .then((r) => (r.ok ? r.json() : null))
              .then((fresh) => {
                if (fresh) setProfile(fresh);
              });
          }}
        />
      ) : null}

      {adminOpen ? (
        <AdminPanel
          mailboxes={mailboxes}
          onClose={() => setAdminOpen(false)}
          onChanged={loadShell}
        />
      ) : null}
    </div>
  );
}

// ── One conversation ─────────────────────────────────────────────────────────

function ThreadView({
  threadId,
  staff,
  onChanged,
  onClose,
}: {
  threadId: string;
  staff: Staff[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  // Hidden until wanted: most replies go to one person, and two empty boxes
  // above every reply is clutter that gets scrolled past.
  const [showCopies, setShowCopies] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [replyAll, setReplyAll] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setThread(await api<ThreadDetail>(`/api/threads/${threadId}`));
    setLoading(false);
  }, [threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(data: Record<string, unknown>) {
    const updated = await api<{ isRead: boolean; isStarred: boolean; state: ThreadDetail['state'] }>(
      `/api/threads/${threadId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
    if (updated) {
      setThread((t) => (t ? { ...t, ...updated } : t));
      onChanged();
    }
  }

  async function assign(userId: string) {
    await api(`/api/threads/${threadId}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ assignedToId: userId || null }),
    });
    await load();
    onChanged();
  }

  async function send() {
    if (!reply.trim()) return;
    setSending(true);
    setError('');

    const res = await fetch(`/api/threads/${threadId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: reply,
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        replyAll,
        attachments: files.length ? files : undefined,
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setSending(false);

    if (data?.sent) {
      setReply('');
      setCc('');
      setBcc('');
      setShowCopies(false);
      setFiles([]);
      await load();
      onChanged();
      bottom.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      // The reply is saved on the thread either way, so say what went wrong
      // rather than losing what was typed.
      setError(data?.error ?? data?.message ?? 'Could not send. Try again.');
      await load();
    }
  }

  /** The whole conversation on paper, which is what a file copy needs. */
  function print() {
    if (!thread) return;
    const messages = thread.messages
      .map(
        (m) => `<div class="msg">
          <p class="who">${escapeHtml(m.fromName || m.fromEmail)}${
            m.direction === 'OUTBOUND' ? '<span class="tag">Sent</span>' : ''
          }</p>
          <p class="addr">${escapeHtml(m.fromEmail)} to ${escapeHtml(m.toEmails.join(', '))}${
            m.ccEmails.length ? ` &middot; cc ${escapeHtml(m.ccEmails.join(', '))}` : ''
          } &middot; ${escapeHtml(new Date(m.createdAt).toLocaleString())}</p>
          <p class="body">${escapeHtml(m.text || '(no text content)')}</p>
        </div>`,
      )
      .join('');

    printDocument(
      thread.subject,
      sheetHead('Conversation', thread.mailbox.address) +
        `<h2 class="subject">${escapeHtml(thread.subject)}</h2>` +
        `<p class="thread-meta">${escapeHtml(thread.participantName || thread.participant)} &middot; ${
          thread.messages.length
        } message${thread.messages.length === 1 ? '' : 's'}</p>` +
        messages +
        `<p class="foot">Printed from the school mail portal.</p>`,
    );
  }

  async function remove() {
    if (!confirm('Delete this conversation permanently? This cannot be undone.')) return;
    await api(`/api/threads/${threadId}`, { method: 'DELETE' });
    onChanged();
    onClose();
  }

  if (loading) {
    return <div className="w-full p-6 text-sm text-ink-muted">Loading</div>;
  }
  if (!thread) {
    return <div className="w-full p-6 text-sm text-ink-muted">Conversation not found.</div>;
  }

  return (
    <div className="flex w-full flex-col bg-paper">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line p-3 sm:p-4">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="rounded-lg p-1.5 text-ink-soft hover:bg-paper-dark md:hidden"
          >
            <Icon name="chevron-left" size={18} />
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink">{thread.subject}</h2>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {thread.participantName ? `${thread.participantName}, ` : ''}
              {thread.participant} to {thread.mailbox.address}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Tool
            label={thread.isStarred ? 'Remove star' : 'Star'}
            icon="star"
            active={thread.isStarred}
            onClick={() => patch({ isStarred: !thread.isStarred })}
          />
          <Tool
            label="Mark unread"
            icon="mail"
            onClick={async () => {
              await patch({ isRead: false });
              onClose();
            }}
          />
          <Tool label="Forward" icon="reply" onClick={() => setForwarding(true)} />
          <Tool label="Print" icon="archive" onClick={print} />
          {thread.state !== 'ARCHIVED' ? (
            <Tool label="Archive" icon="archive" onClick={() => patch({ state: 'ARCHIVED' })} />
          ) : (
            <Tool label="Move to inbox" icon="inbox" onClick={() => patch({ state: 'OPEN' })} />
          )}
          {thread.state !== 'SPAM' ? (
            <Tool label="Mark spam" icon="shield" onClick={() => patch({ state: 'SPAM' })} />
          ) : (
            <Tool label="Not spam" icon="inbox" onClick={() => patch({ state: 'OPEN' })} />
          )}
          <Tool label="Delete" icon="trash" danger onClick={remove} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper-soft px-4 py-2">
        <label htmlFor="assignee" className="text-xs font-medium text-ink-soft">
          Assigned to
        </label>
        <select
          id="assignee"
          value={thread.assignedTo?.id ?? ''}
          onChange={(e) => assign(e.target.value)}
          className="rounded-full border border-line bg-paper px-3 py-1 text-xs focus:border-crimson-500 focus:outline-none"
        >
          <option value="">Nobody</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.firstName} {s.lastName}
            </option>
          ))}
        </select>
        {thread.state === 'SPAM' ? (
          <span className="rounded-full bg-crimson-50 px-2 py-0.5 text-[11px] font-semibold text-crimson-800">
            In spam
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
        {thread.messages.map((m) => (
          <MessageCard key={m.id} message={m} />
        ))}
        <div ref={bottom} />
      </div>

      {forwarding ? (
        <ForwardDialog
          thread={thread}
          onClose={() => setForwarding(false)}
          onSent={() => {
            setForwarding(false);
            onChanged();
          }}
        />
      ) : null}

      <div className="border-t border-line p-3 sm:p-4">
        {thread.canSend === false ? (
          <p className="rounded-xl bg-paper-dark px-4 py-3 text-sm text-ink-soft">
            You can read {thread.mailbox.address} but not send from it. Ask an administrator for
            permission if you need to answer.
          </p>
        ) : (
          <>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label htmlFor="reply" className="text-xs font-semibold text-ink-soft">
                Reply as {thread.mailbox.address}
              </label>
              <span className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    checked={replyAll}
                    onChange={(e) => setReplyAll(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-line text-crimson-500"
                  />
                  Reply to all
                </label>
                <button
                  type="button"
                  onClick={() => setShowCopies((v) => !v)}
                  className="text-xs font-semibold text-crimson-700 hover:underline"
                >
                  {showCopies ? 'Hide Cc and Bcc' : 'Cc and Bcc'}
                </button>
              </span>
            </div>

            {showCopies ? (
              <div className="mb-2 grid gap-2 sm:grid-cols-2">
                <input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="Cc, separated by commas"
                  aria-label="Cc"
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
                />
                <input
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="Bcc, hidden from everyone"
                  aria-label="Bcc"
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
                />
              </div>
            ) : null}
            <textarea
              id="reply"
              rows={4}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={`Reply to ${thread.participantName || thread.participant}`}
              className="w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink focus:border-crimson-500 focus:outline-none"
            />
            <AttachmentPicker items={files} onChange={setFiles} disabled={sending} />
            {error ? <p className="mt-2 text-sm text-crimson-700">{error}</p> : null}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={send}
                disabled={sending || !reply.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-crimson-500 px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-600 disabled:opacity-50"
              >
                <Icon name="send" size={15} /> {sending ? 'Sending' : 'Send reply'}
              </button>
              {thread.mailbox.signature ? (
                <span className="text-xs text-ink-muted">Signature will be added.</span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MessageCard({ message }: { message: ThreadDetail['messages'][number] }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const outbound = message.direction === 'OUTBOUND';

  return (
    <article
      className={[
        'rounded-xl border p-3.5',
        outbound ? 'border-crimson-200 bg-crimson-50/40' : 'border-line bg-paper-soft',
      ].join(' ')}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">
            {message.fromName || message.fromEmail}
            {outbound ? (
              <span className="ml-2 rounded bg-crimson-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Sent
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-ink-muted">
            {message.fromEmail} to {message.toEmails.join(', ')}
            {message.ccEmails.length ? ` (cc ${message.ccEmails.join(', ')})` : ''}
            {outbound && message.bccEmails?.length ? ` (bcc ${message.bccEmails.join(', ')})` : ''}
          </p>
        </div>
        <time className="shrink-0 text-xs text-ink-muted" dateTime={message.createdAt}>
          {new Date(message.createdAt).toLocaleString()}
        </time>
      </header>

      {message.deliveryError ? (
        <p className="mt-2 rounded-lg bg-crimson-100 px-3 py-2 text-xs text-crimson-900">
          Not delivered: {message.deliveryError}. The text is kept here so nothing is lost.
        </p>
      ) : null}

      <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-soft">
        {message.text || '(no text content)'}
      </div>

      {message.html ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="text-xs font-semibold text-crimson-700 hover:underline"
          >
            {showOriginal ? 'Hide original formatting' : 'Show original formatting'}
          </button>
          {showOriginal ? (
            // Sender HTML is untrusted, so it renders in a sandboxed frame with
            // scripts disabled rather than into this page.
            <iframe
              title="Original message"
              sandbox=""
              srcDoc={message.html}
              className="mt-2 h-80 w-full rounded-lg border border-line bg-paper"
            />
          ) : null}
        </div>
      ) : null}

      {message.attachments.filter((a) => !a.isInline).length ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          {message.attachments
            .filter((a) => !a.isInline)
            .map((a) =>
              a.storageKey || a.url ? (
                <a
                  key={a.id}
                  href={a.storageKey ? `/api/attachments/${a.id}` : (a.url as string)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-xs text-ink-soft hover:border-crimson-300 hover:text-crimson-700"
                >
                  <Icon name="paperclip" size={12} /> {a.fileName}
                  {a.sizeBytes ? <span className="text-ink-muted">{formatBytes(a.sizeBytes)}</span> : null}
                </a>
              ) : (
                <span
                  key={a.id}
                  title="File storage was not set up when this arrived."
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-ink-muted"
                >
                  <Icon name="paperclip" size={12} /> {a.fileName} (not stored)
                </span>
              ),
            )}
        </div>
      ) : null}
    </article>
  );
}

function Tool({
  label,
  icon,
  onClick,
  active,
  danger,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        'rounded-lg p-2 transition-colors',
        active ? 'text-crimson-500' : 'text-ink-muted',
        danger ? 'hover:bg-crimson-50 hover:text-crimson-700' : 'hover:bg-paper-dark hover:text-ink',
      ].join(' ')}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/**
 * Passes a conversation on to somebody else.
 *
 * It opens a new conversation rather than continuing this one, because a
 * conversation here is filed against the person on the other end of it, and a
 * forward to the bursar does not belong inside a parent's file.
 */
function ForwardDialog({
  thread,
  onClose,
  onSent,
}: {
  thread: ThreadDetail;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [note, setNote] = useState('');
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const files = thread.messages.flatMap((m) => m.attachments.filter((a) => !a.isInline));

  async function send() {
    setSending(true);
    setError('');
    const res = await fetch(`/api/threads/${thread.id}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, cc: cc.trim() || undefined, note, includeAttachments }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setSending(false);
    if (data?.sent) onSent();
    else setError(data?.error ?? data?.message ?? 'Could not forward it.');
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-paper shadow-xl sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">Forward</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-muted hover:bg-paper-dark"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <p className="rounded-xl bg-paper-soft px-3 py-2 text-xs text-ink-soft">
            Sending <strong>{thread.subject}</strong> as {thread.mailbox.address}. The original
            message is quoted underneath whatever you write.
          </p>

          <Field label="To">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="bursar@example.com"
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
            />
          </Field>
          <Field label="Cc">
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
            />
          </Field>
          <Field label="Add a note" hint="Optional, appears above the forwarded message.">
            <textarea
              rows={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
            />
          </Field>

          {files.length ? (
            <label className="flex items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={includeAttachments}
                onChange={(e) => setIncludeAttachments(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line text-crimson-500"
              />
              <span>
                Include {files.length} attachment{files.length === 1 ? '' : 's'}
                <span className="block text-xs text-ink-muted">
                  {files.slice(0, 3).map((f) => f.fileName).join(', ')}
                  {files.length > 3 ? ` and ${files.length - 3} more` : ''}
                </span>
              </span>
            </label>
          ) : null}

          {error ? <p className="text-sm text-crimson-700">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-ink-muted hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !to.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-crimson-500 px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-600 disabled:opacity-50"
          >
            <Icon name="send" size={15} /> {sending ? 'Sending' : 'Forward'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── Attachments ──────────────────────────────────────────────────────────────

function AttachmentPicker({
  items,
  onChange,
  disabled,
}: {
  items: Attachment[];
  onChange: (next: Attachment[]) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    const added: Attachment[] = [];

    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/attachments', { method: 'POST', body: form }).catch(() => null);
      if (res && res.ok) {
        const row = (await res.json()) as { id: string; fileName: string; sizeBytes: number };
        added.push({ attachmentId: row.id, fileName: row.fileName, sizeBytes: row.sizeBytes });
      } else {
        const data = res ? await res.json().catch(() => null) : null;
        setError(data?.message ?? `Could not attach ${file.name}.`);
      }
    }

    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (added.length) onChange([...items, ...added]);
  }

  function addLink() {
    const url = link.trim();
    if (!/^https:\/\//i.test(url)) {
      setError('Links must start with https://');
      return;
    }
    const name = decodeURIComponent(url.split('/').pop() || 'link').split('?')[0] || 'link';
    onChange([...items, { fileName: name.slice(0, 120), url }]);
    setLink('');
    setLinking(false);
    setError('');
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-crimson-300 hover:text-crimson-700 disabled:opacity-50"
        >
          <Icon name="paperclip" size={13} /> {busy ? 'Uploading' : 'Attach a file'}
        </button>
        <button
          type="button"
          onClick={() => setLinking((v) => !v)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-crimson-300 hover:text-crimson-700 disabled:opacity-50"
        >
          <Icon name="link" size={13} /> Attach a link
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => pick(e.target.files)} />
      </div>

      {linking ? (
        <div className="mt-2 flex gap-2">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://"
            className="flex-1 rounded-lg border border-line px-3 py-1.5 text-sm focus:border-crimson-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={addLink}
            className="rounded-full bg-crimson-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-crimson-600"
          >
            Add
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-1.5 text-xs text-crimson-700">{error}</p> : null}

      {items.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {items.map((a, i) => (
            <li
              key={`${a.attachmentId ?? a.url}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-soft px-3 py-1.5 text-xs text-ink-soft"
            >
              <Icon name="paperclip" size={11} />
              <span className="max-w-[12rem] truncate">{a.fileName}</span>
              {a.sizeBytes ? <span className="text-ink-muted">{formatBytes(a.sizeBytes)}</span> : null}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Remove ${a.fileName}`}
                className="rounded-full p-0.5 text-ink-muted hover:text-crimson-700"
              >
                <Icon name="close" size={11} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ── Compose ──────────────────────────────────────────────────────────────────

function ComposeDialog({
  mailboxes,
  onClose,
  onSent,
}: {
  mailboxes: Mailbox[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCopies, setShowCopies] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    setSending(true);
    setError('');
    const res = await fetch('/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mailboxId,
        to,
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject,
        body,
        attachments: files.length ? files : undefined,
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setSending(false);
    if (data?.sent) onSent();
    else setError(data?.error ?? data?.message ?? 'Could not send. Check the addresses.');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-2xl border border-line bg-paper shadow-xl sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">New message</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-muted hover:bg-paper-dark"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <Field label="Send from">
            <select
              value={mailboxId}
              onChange={(e) => setMailboxId(e.target.value)}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
            >
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.address}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="text-xs font-semibold text-ink-soft">To</label>
              <button
                type="button"
                onClick={() => setShowCopies((v) => !v)}
                className="text-xs font-semibold text-crimson-700 hover:underline"
              >
                {showCopies ? 'Hide Cc and Bcc' : 'Cc and Bcc'}
              </button>
            </div>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="parent@example.com, another@example.com"
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
            />
          </div>
          {showCopies ? (
            <>
              <Field label="Cc" hint="Everyone can see these recipients.">
                <input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="someone@example.com"
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
                />
              </Field>
              <Field label="Bcc" hint="Hidden from everyone, including each other.">
                <input
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="someone@example.com"
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
                />
              </Field>
            </>
          ) : null}
          <Field label="Subject">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
            />
          </Field>
          <Field label="Message">
            <textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:border-crimson-500 focus:outline-none"
            />
            <AttachmentPicker items={files} onChange={setFiles} disabled={sending} />
          </Field>
          {error ? <p className="text-sm text-crimson-700">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-ink-muted hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !mailboxId || !to.trim() || !subject.trim() || !body.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-crimson-500 px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-600 disabled:opacity-50"
          >
            <Icon name="send" size={15} /> {sending ? 'Sending' : 'Send'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {label ? <label className="mb-1 block text-xs font-semibold text-ink-soft">{label}</label> : null}
      {children}
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
