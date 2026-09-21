import { randomUUID } from 'node:crypto';
import { Prisma, type MailThreadState } from '@prisma/client';
import { db } from '@/lib/db';
import { sendMail, type Attachment } from '@/lib/send';

/** What a caller asks to attach: a file already uploaded, or an outside link. */
export type OutgoingAttachment =
  | { attachmentId: string }
  | { fileName: string; url: string; mimeType?: string };
import { htmlToText, snippetOf, subjectKeyOf, type NormalizedMail } from '@/lib/mail-parse';
import { getFile, putFile } from '@/lib/storage';
import type { SessionUser } from '@/lib/auth';

/** How far back a subject match may reach when a client drops its headers. */
const FALLBACK_WINDOW_DAYS = 180;

// ── Access ───────────────────────────────────────────────────────────────────

export type MailAccess = {
  /** True for an administrator, who works in every address. */
  all: boolean;
  mailboxIds: string[];
  canSend(mailboxId: string): boolean;
};

/**
 * Which addresses this person may work in.
 *
 * Everything that reads or writes mail resolves this first, so a Kisaasi
 * secretary can never open a Nakasero conversation, not even by guessing its id.
 */
export async function accessFor(user: SessionUser): Promise<MailAccess> {
  if (user.role === 'ADMIN') {
    return { all: true, mailboxIds: [], canSend: () => true };
  }
  const rows = await db.mailboxMember.findMany({
    where: { userId: user.id, mailbox: { isActive: true } },
    select: { mailboxId: true, canSend: true },
  });
  const sendable = new Set(rows.filter((r) => r.canSend).map((r) => r.mailboxId));
  return {
    all: false,
    mailboxIds: rows.map((r) => r.mailboxId),
    canSend: (id) => sendable.has(id),
  };
}

function scope(access: MailAccess): Prisma.MailThreadWhereInput {
  return access.all ? {} : { mailboxId: { in: access.mailboxIds } };
}

/** Loads a thread only if this person may see it. */
async function threadInScope(id: string, access: MailAccess) {
  const thread = await db.mailThread.findUnique({
    where: { id },
    select: { id: true, mailboxId: true },
  });
  // The same answer for "not yours" as for "does not exist", so the mailbox
  // cannot be mapped out by probing ids.
  if (!thread) return null;
  if (!access.all && !access.mailboxIds.includes(thread.mailboxId)) return null;
  return thread;
}

// ── Inbound ──────────────────────────────────────────────────────────────────

export type DeliveryResult =
  | { delivered: true; threadId: string; messageId: string; duplicate: boolean }
  | { delivered: false; reason: string };

/** Exact address match on any recipient first, then the catch-all. */
async function resolveMailbox(mail: NormalizedMail) {
  const candidates = [...mail.to, ...mail.cc].map((a) => a.email.toLowerCase());
  if (candidates.length) {
    const exact = await db.mailbox.findFirst({
      where: { isActive: true, address: { in: candidates, mode: 'insensitive' } },
      orderBy: { sortOrder: 'asc' },
    });
    if (exact) return exact;
  }
  return db.mailbox.findFirst({
    where: { isActive: true, isCatchAll: true },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * The conversation a message continues.
 *
 * Message-ID chains are authoritative. When the sending client drops them, which
 * Outlook and several webmail clients do, a same-subject message from the same
 * person inside the window is treated as the same conversation, which is what
 * the office expects to see.
 */
async function findThread(mailboxId: string, mail: NormalizedMail) {
  const chain = [mail.inReplyTo, ...mail.references].filter((v): v is string => Boolean(v));
  if (chain.length) {
    const parent = await db.mailMessage.findFirst({
      where: { messageId: { in: chain }, thread: { mailboxId } },
      orderBy: { createdAt: 'desc' },
      select: { threadId: true },
    });
    if (parent) return db.mailThread.findUnique({ where: { id: parent.threadId } });
  }

  const since = new Date(Date.now() - FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return db.mailThread.findFirst({
    where: {
      mailboxId,
      subjectKey: subjectKeyOf(mail.subject),
      participant: mail.from.email,
      state: { not: 'TRASH' },
      lastMessageAt: { gte: since },
    },
    orderBy: { lastMessageAt: 'desc' },
  });
}

export async function deliver(mail: NormalizedMail): Promise<DeliveryResult> {
  const mailbox = await resolveMailbox(mail);
  if (!mailbox) {
    const attempted = [...mail.to, ...mail.cc].map((a) => a.email).join(', ') || 'unknown';
    return { delivered: false, reason: `No active mailbox for ${attempted}` };
  }

  // A provider retrying after a timeout must not create a second copy.
  if (mail.messageId) {
    const existing = await db.mailMessage.findUnique({
      where: { messageId: mail.messageId },
      select: { id: true, threadId: true },
    });
    if (existing) {
      return { delivered: true, threadId: existing.threadId, messageId: existing.id, duplicate: true };
    }
  }

  const snippet = snippetOf(mail.text, mail.html);
  const hasAttachments = mail.attachments.some((a) => !a.isInline);
  const spam = mail.isSpam;

  let thread = await findThread(mailbox.id, mail);
  if (thread) {
    thread = await db.mailThread.update({
      where: { id: thread.id },
      data: {
        snippet,
        isRead: false,
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
        hasAttachments: thread.hasAttachments || hasAttachments,
        // A reply pulls an archived conversation back into the inbox.
        state: thread.state === 'ARCHIVED' ? 'OPEN' : thread.state,
      },
    });
  } else {
    thread = await db.mailThread.create({
      data: {
        mailboxId: mailbox.id,
        subject: mail.subject.slice(0, 500),
        subjectKey: subjectKeyOf(mail.subject),
        participant: mail.from.email,
        participantName: mail.from.name?.slice(0, 200) ?? null,
        snippet,
        state: spam ? 'SPAM' : 'OPEN',
        messageCount: 1,
        hasAttachments,
        lastMessageAt: new Date(),
      },
    });
  }

  // Uploaded first so the keys can be written with the message. A file that
  // fails to store leaves a null key and is shown as unavailable; the message
  // itself is never lost over an attachment.
  const stored = await Promise.all(
    mail.attachments.map(async (a) => ({
      a,
      key: await putFile(a.content, a.fileName, a.mimeType, 'inbound'),
    })),
  );

  const message = await db.mailMessage.create({
    data: {
      threadId: thread.id,
      direction: 'INBOUND',
      messageId: mail.messageId ?? null,
      inReplyTo: mail.inReplyTo ?? null,
      references: mail.references,
      fromName: mail.from.name?.slice(0, 200) ?? null,
      fromEmail: mail.from.email,
      toEmails: mail.to.map((a) => a.email),
      ccEmails: mail.cc.map((a) => a.email),
      subject: mail.subject.slice(0, 500),
      text: mail.text ?? (mail.html ? htmlToText(mail.html) : null),
      html: mail.html ?? null,
      spamScore: mail.spamScore ?? null,
      isSpam: spam,
      headers: (mail.headers ?? undefined) as Prisma.InputJsonValue | undefined,
      sizeBytes: mail.sizeBytes ?? null,
      attachments: stored.length
        ? {
            create: stored.map(({ a, key }) => ({
              fileName: a.fileName.slice(0, 250),
              mimeType: a.mimeType.slice(0, 150),
              sizeBytes: a.content.length,
              storageKey: key,
              contentId: a.contentId ?? null,
              isInline: a.isInline,
            })),
          }
        : undefined,
    },
  });

  // Auto-reply only on a fresh, non-spam conversation, so two auto-responders
  // can never answer each other in a loop.
  if (mailbox.autoReplyEnabled && !spam && thread.messageCount <= 1 && mailbox.autoReplyBody?.trim()) {
    void sendOutbound({
      threadId: thread.id,
      mailbox,
      to: [mail.from.email],
      cc: [],
      bcc: [],
      subject: mailbox.autoReplySubject?.trim() || `Re: ${mail.subject}`,
      bodyText: mailbox.autoReplyBody,
      inReplyTo: message.messageId,
      references: mail.references,
      sentById: null,
      quote: null,
    }).catch(() => {
      /* an auto-reply failing must not fail the delivery */
    });
  }

  return { delivered: true, threadId: thread.id, messageId: message.id, duplicate: false };
}

// ── Outbound ─────────────────────────────────────────────────────────────────

type OutboundMailbox = {
  id: string;
  address: string;
  displayName: string;
  signature?: string | null;
  signatureImageUrl?: string | null;
  avatarUrl?: string | null;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The sender's picture and name across the top of an outgoing message, as a
 * table with inline styles because that is the only layout every mail client
 * agrees on. Omitted entirely when there is no picture, so a plain reply stays
 * plain.
 */
/**
 * The picture to put on an outgoing message: the address's own if one was set,
 * otherwise the schools' badge, so mail is recognisable by default rather than
 * only when somebody remembers.
 *
 * Mail clients cannot resolve a relative path, so the badge is only usable once
 * the public origin is known.
 */
function badgeFor(mailbox: OutboundMailbox): string | null {
  if (mailbox.avatarUrl) return mailbox.avatarUrl;
  const origin = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (!origin) return null;
  const base = /^https?:\/\//i.test(origin) ? origin : `https://${origin}`;
  return `${base}/sak.jpg`;
}

function senderHeader(mailbox: OutboundMailbox): string {
  const badge = badgeFor(mailbox);
  if (!badge) return '';
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-collapse:collapse;">` +
    `<tr><td style="padding-right:12px;vertical-align:middle;">` +
    `<img src="${escapeHtml(badge)}" width="46" height="46" alt="" ` +
    `style="width:46px;height:46px;border-radius:23px;display:block;border:0;" /></td>` +
    `<td style="vertical-align:middle;">` +
    `<div style="font-size:15px;font-weight:bold;color:#A81433;line-height:1.3;">${escapeHtml(mailbox.displayName)}</div>` +
    `<div style="font-size:12px;color:#8a8a8a;line-height:1.3;">${escapeHtml(mailbox.address)}</div>` +
    `</td></tr></table>`
  );
}

function bodyToHtml(text: string, mailbox: OutboundMailbox, quote?: string | null): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const sigText = mailbox.signature?.trim()
    ? `<div style="margin-top:18px;color:#6b6b6b;font-size:13px;">${escapeHtml(mailbox.signature).replace(/\n/g, '<br>')}</div>`
    : '';
  // Width capped and height left to follow, so a large upload cannot stretch the
  // message open on a phone.
  const sigImage = mailbox.signatureImageUrl
    ? `<div style="margin-top:12px;"><img src="${escapeHtml(mailbox.signatureImageUrl)}" alt="" style="max-width:260px;height:auto;display:block;border:0;" /></div>`
    : '';
  const sig = sigText + sigImage;
  const quoted = quote?.trim()
    ? `<blockquote style="margin:18px 0 0;padding-left:12px;border-left:2px solid #d9d2d3;color:#6b6b6b;">${escapeHtml(quote).replace(/\n/g, '<br>')}</blockquote>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#141C26;">${senderHeader(mailbox)}${paragraphs}${sig}${quoted}</div>`;
}

/**
 * Turns what the caller asked for into what the provider is given.
 *
 * Our own files go inline as base64 rather than as a URL, which is what lets the
 * bucket stay private: nothing has to be publicly readable for the provider to
 * fetch it. A file that cannot be read back is skipped rather than failing the
 * send, since a message that goes without its attachment beats one that does not
 * go at all.
 */
async function resolveAttachments(
  wanted: OutgoingAttachment[] | undefined,
  userId: string | null,
): Promise<{ toSend: Attachment[]; claimIds: string[] }> {
  if (!wanted?.length) return { toSend: [], claimIds: [] };

  const toSend: Attachment[] = [];
  const claimIds: string[] = [];

  for (const item of wanted) {
    if ('url' in item) {
      toSend.push({ kind: 'link', fileName: item.fileName, url: item.url, mimeType: item.mimeType });
      continue;
    }
    const row = await db.mailAttachment.findUnique({
      where: { id: item.attachmentId },
      select: { id: true, fileName: true, mimeType: true, storageKey: true, messageId: true, uploadedById: true },
    });
    // Only a file this person uploaded and has not already sent.
    if (!row?.storageKey || row.messageId || (userId && row.uploadedById !== userId)) continue;

    const file = await getFile(row.storageKey);
    if (!file) continue;

    toSend.push({
      kind: 'stored',
      fileName: row.fileName,
      mimeType: row.mimeType,
      content: Buffer.from(file.body).toString('base64'),
    });
    claimIds.push(row.id);
  }
  return { toSend, claimIds };
}

async function sendOutbound(opts: {
  threadId: string;
  mailbox: OutboundMailbox;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  inReplyTo: string | null;
  references: string[];
  sentById: string | null;
  quote: string | null;
  attachments?: OutgoingAttachment[];
}) {
  const domain = opts.mailbox.address.split('@')[1] ?? 'localhost';
  const messageId = `<${randomUUID()}@${domain}>`;
  const references = [...opts.references, ...(opts.inReplyTo ? [opts.inReplyTo] : [])]
    .filter((v, i, a) => v && a.indexOf(v) === i)
    .slice(-20);

  const { toSend, claimIds } = await resolveAttachments(opts.attachments, opts.sentById);
  const html = bodyToHtml(opts.bodyText, opts.mailbox, opts.quote);
  const headers: Record<string, string> = {};
  if (opts.inReplyTo) headers['In-Reply-To'] = opts.inReplyTo;
  if (references.length) headers['References'] = references.join(' ');

  const result = await sendMail({
    from: { name: opts.mailbox.displayName, email: opts.mailbox.address },
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    html,
    text: opts.bodyText + (opts.mailbox.signature ? `\n\n${opts.mailbox.signature}` : ''),
    replyTo: opts.mailbox.address,
    messageId,
    headers,
    attachments: toSend,
  });

  // Recorded either way, so the thread shows what was written and why it did
  // not leave, rather than losing it.
  const stored = await db.mailMessage.create({
    data: {
      threadId: opts.threadId,
      direction: 'OUTBOUND',
      messageId,
      inReplyTo: opts.inReplyTo,
      references,
      fromName: opts.mailbox.displayName,
      fromEmail: opts.mailbox.address,
      toEmails: opts.to,
      ccEmails: opts.cc,
      bccEmails: opts.bcc,
      subject: opts.subject.slice(0, 500),
      text: opts.bodyText,
      html,
      sentById: opts.sentById,
      deliveryError: result.sent ? null : (result.error ?? 'Unknown send failure'),
      // Only outside links are created here. Uploaded files already have a row,
      // and are attached to this message below rather than duplicated.
      attachments: opts.attachments?.some((a) => 'url' in a)
        ? {
            create: opts.attachments
              .filter((a): a is { fileName: string; url: string; mimeType?: string } => 'url' in a)
              .map((a) => ({
                fileName: a.fileName.slice(0, 250),
                mimeType: (a.mimeType ?? 'application/octet-stream').slice(0, 150),
                sizeBytes: 0,
                url: a.url,
                isInline: false,
              })),
          }
        : undefined,
    },
    include: { attachments: true },
  });

  // Claimed before the row is read back, or the reply that just went out would
  // report having no attachments while the files sit correctly in storage.
  let saved = stored;
  if (claimIds.length) {
    await db.mailAttachment.updateMany({
      where: { id: { in: claimIds } },
      data: { messageId: stored.id },
    });
    saved =
      (await db.mailMessage.findUnique({
        where: { id: stored.id },
        include: { attachments: true },
      })) ?? stored;
  }

  await db.mailThread.update({
    where: { id: opts.threadId },
    data: {
      snippet: snippetOf(opts.bodyText),
      lastMessageAt: new Date(),
      isRead: true,
      messageCount: { increment: 1 },
      ...(opts.attachments?.length ? { hasAttachments: true } : {}),
    },
  });

  return { ...result, message: saved };
}

export async function reply(
  threadId: string,
  user: SessionUser,
  access: MailAccess,
  bodyText: string,
  cc?: string[],
  attachments?: OutgoingAttachment[],
  bcc?: string[],
) {
  const scoped = await threadInScope(threadId, access);
  if (!scoped) return { error: 'notfound' as const };
  if (!access.canSend(scoped.mailboxId)) return { error: 'readonly' as const };

  const thread = await db.mailThread.findUnique({
    where: { id: threadId },
    include: { mailbox: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!thread) return { error: 'notfound' as const };

  const last = thread.messages[0];
  const quote = last
    ? `On ${last.createdAt.toDateString()}, ${last.fromName || last.fromEmail} wrote:\n${(
        last.text ?? htmlToText(last.html)
      ).slice(0, 4000)}`
    : null;

  const result = await sendOutbound({
    threadId,
    mailbox: thread.mailbox,
    to: [thread.participant],
    cc: cc ?? [],
    bcc: bcc ?? [],
    subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
    bodyText,
    inReplyTo: last?.messageId ?? null,
    references: last?.references ?? [],
    sentById: user.id,
    quote,
    attachments,
  });
  return { result };
}

export async function compose(input: {
  mailboxId: string;
  user: SessionUser;
  access: MailAccess;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments?: OutgoingAttachment[];
}) {
  const mailbox = await db.mailbox.findUnique({ where: { id: input.mailboxId } });
  if (!mailbox) return { error: 'notfound' as const };
  if (!input.access.all && !input.access.mailboxIds.includes(mailbox.id)) {
    return { error: 'notfound' as const };
  }
  if (!input.access.canSend(mailbox.id)) return { error: 'readonly' as const };
  if (!input.to.length) return { error: 'norecipient' as const };

  const thread = await db.mailThread.create({
    data: {
      mailboxId: mailbox.id,
      subject: input.subject.slice(0, 500),
      subjectKey: subjectKeyOf(input.subject),
      participant: input.to[0].toLowerCase(),
      snippet: snippetOf(input.body),
      isRead: true,
      messageCount: 0,
      lastMessageAt: new Date(),
    },
  });

  const result = await sendOutbound({
    threadId: thread.id,
    mailbox,
    to: input.to,
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    subject: input.subject,
    bodyText: input.body,
    inReplyTo: null,
    references: [],
    sentById: input.user.id,
    quote: null,
    attachments: input.attachments,
  });
  return { result: { ...result, threadId: thread.id } };
}

// ── Reading ──────────────────────────────────────────────────────────────────

export async function counts(access: MailAccess) {
  const mine = scope(access);
  const [byMailbox, starred, sent, archived, spam, trash] = await Promise.all([
    db.mailThread.groupBy({
      by: ['mailboxId'],
      where: { ...mine, state: 'OPEN', isRead: false },
      _count: { _all: true },
    }),
    db.mailThread.count({ where: { ...mine, isStarred: true, state: { not: 'TRASH' } } }),
    db.mailThread.count({
      where: { ...mine, state: { not: 'TRASH' }, messages: { some: { direction: 'OUTBOUND' } } },
    }),
    db.mailThread.count({ where: { ...mine, state: 'ARCHIVED' } }),
    db.mailThread.count({ where: { ...mine, state: 'SPAM' } }),
    db.mailThread.count({ where: { ...mine, state: 'TRASH' } }),
  ]);

  return {
    unread: Object.fromEntries(byMailbox.map((r) => [r.mailboxId, r._count._all])),
    totalUnread: byMailbox.reduce((sum, r) => sum + r._count._all, 0),
    starred,
    sent,
    archived,
    spam,
    trash,
  };
}

export async function listThreads(
  q: {
    mailboxId?: string;
    state?: MailThreadState;
    starred?: boolean;
    sent?: boolean;
    search?: string;
    take?: number;
    skip?: number;
  },
  access: MailAccess,
) {
  // A requested address is honoured only when it is one of theirs.
  const base =
    q.mailboxId && (access.all || access.mailboxIds.includes(q.mailboxId))
      ? { mailboxId: q.mailboxId }
      : scope(access);

  const where: Prisma.MailThreadWhereInput = {
    ...base,
    ...(q.starred ? { isStarred: true } : {}),
    ...(q.sent ? { messages: { some: { direction: 'OUTBOUND' as const } } } : {}),
    // Starred and Sent reach across folders, so neither may pin state to OPEN.
    ...(q.state ? { state: q.state } : q.starred || q.sent ? { state: { not: 'TRASH' } } : {}),
  };

  if (q.search) {
    const term = q.search.trim();
    where.OR = [
      { subject: { contains: term, mode: 'insensitive' } },
      { snippet: { contains: term, mode: 'insensitive' } },
      { participant: { contains: term, mode: 'insensitive' } },
      { participantName: { contains: term, mode: 'insensitive' } },
      { messages: { some: { text: { contains: term, mode: 'insensitive' } } } },
    ];
  }

  const take = Math.min(Math.max(q.take ?? 40, 1), 100);
  const [items, total] = await Promise.all([
    db.mailThread.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take,
      skip: Math.max(q.skip ?? 0, 0),
      include: {
        mailbox: { select: { id: true, address: true, displayName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    }),
    db.mailThread.count({ where }),
  ]);
  return { items, total };
}

export async function getThread(id: string, access: MailAccess) {
  const scoped = await threadInScope(id, access);
  if (!scoped) return null;

  const thread = await db.mailThread.findUnique({
    where: { id },
    include: {
      mailbox: { select: { id: true, address: true, displayName: true, signature: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          attachments: true,
          sentBy: { select: { firstName: true, lastName: true, avatarUrl: true } },
        },
      },
    },
  });
  if (!thread) return null;
  return { ...thread, canSend: access.canSend(thread.mailboxId) };
}

export async function updateThread(
  id: string,
  access: MailAccess,
  data: { isRead?: boolean; isStarred?: boolean; state?: MailThreadState },
) {
  if (!(await threadInScope(id, access))) return null;
  return db.mailThread.update({ where: { id }, data });
}

export async function assignThread(id: string, access: MailAccess, assignedToId: string | null) {
  const scoped = await threadInScope(id, access);
  if (!scoped) return { error: 'notfound' as const };

  if (assignedToId) {
    // Handing a conversation to somebody without access would put it where
    // they cannot open it.
    const member = await db.mailboxMember.findUnique({
      where: { mailboxId_userId: { mailboxId: scoped.mailboxId, userId: assignedToId } },
      select: { id: true },
    });
    if (!member) {
      const admin = await db.user.findFirst({
        where: { id: assignedToId, role: 'ADMIN' },
        select: { id: true },
      });
      if (!admin) return { error: 'noaccess' as const };
    }
  }

  const thread = await db.mailThread.update({
    where: { id },
    data: { assignedToId },
    include: { assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
  });
  return { thread };
}

export async function deleteThread(id: string, access: MailAccess) {
  if (!(await threadInScope(id, access))) return false;
  await db.mailThread.delete({ where: { id } });
  return true;
}
