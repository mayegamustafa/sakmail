/**
 * Turns whatever an inbound mail provider posts at us into one shape the rest
 * of the app understands.
 *
 * Every provider describes the same message differently: Cloudflare (through
 * the Worker in docs/cloudflare-email-worker.js), Postmark, SendGrid Inbound
 * Parse and Mailgun Routes all use their own field names. Normalising here
 * means the school can switch provider later without touching the database,
 * the threading rules or the admin screen.
 */

export type MailAddress = { name?: string; email: string };

export type NormalizedAttachment = {
  fileName: string;
  mimeType: string;
  content: Buffer;
  contentId?: string;
  isInline: boolean;
};

export type NormalizedMail = {
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  text?: string;
  html?: string;
  spamScore?: number;
  isSpam: boolean;
  headers?: Record<string, unknown>;
  sizeBytes?: number;
  attachments: NormalizedAttachment[];
};

/** An uploaded part, when the provider posts multipart/form-data. */
export type IncomingFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

// ── Addresses ────────────────────────────────────────────────────────────────

const EMAIL_RE = /[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+/;

/** Parses `Display Name <user@host>`, `"Name" <user@host>` or a bare address. */
export function parseAddress(raw?: string | null): MailAddress | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  const angled = value.match(/^(.*)<([^>]+)>\s*$/);
  if (angled) {
    const email = angled[2].trim().toLowerCase();
    const name = angled[1].trim().replace(/^["']|["']$/g, '').trim();
    if (!EMAIL_RE.test(email)) return null;
    return { email, name: name || undefined };
  }

  const bare = value.match(EMAIL_RE);
  return bare ? { email: bare[0].toLowerCase() } : null;
}

/** Splits an address list on commas that sit outside quotes and angle brackets. */
export function parseAddressList(raw?: string | null): MailAddress[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as string[]).flatMap((r) => parseAddressList(r));

  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const ch of String(raw)) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '<') inAngle = true;
    else if (ch === '>') inAngle = false;
    if ((ch === ',' || ch === ';') && !inQuotes && !inAngle) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  const seen = new Set<string>();
  const out: MailAddress[] = [];
  for (const part of parts) {
    const addr = parseAddress(part);
    if (addr && !seen.has(addr.email)) {
      seen.add(addr.email);
      out.push(addr);
    }
  }
  return out;
}

// ── Subjects ─────────────────────────────────────────────────────────────────

const REPLY_PREFIX = /^\s*((re|aw|sv|fw|fwd|vs|antwort)\s*(\[\d+\])?\s*:\s*)+/i;

/**
 * Strips reply/forward prefixes and collapses whitespace, giving a stable key
 * for matching a reply back onto its conversation when the sending client drops
 * the References header (Outlook and several webmail clients do).
 */
export function subjectKeyOf(subject?: string | null): string {
  return String(subject ?? '')
    .replace(REPLY_PREFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

// ── Bodies ───────────────────────────────────────────────────────────────────

/** Readable plain text from an HTML body, for previews and search. */
export function htmlToText(html?: string | null): string {
  if (!html) return '';
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One-line preview, with quoted history trimmed off the bottom. */
export function snippetOf(text?: string | null, html?: string | null, max = 220): string {
  const body = (text && text.trim()) || htmlToText(html);
  const withoutQuotes = body
    .split(/\n\s*(?:On .+ wrote:|-{2,}\s*Original Message\s*-{2,}|_{5,})/i)[0]
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutQuotes.slice(0, max);
}

/** Splits a References header into individual message ids. */
export function parseReferences(raw?: string | string[] | null): string[] {
  if (!raw) return [];
  const value = Array.isArray(raw) ? raw.join(' ') : String(raw);
  return value.match(/<[^>\s]+>/g) ?? [];
}

/** Normalises a Message-ID to its angle-bracketed form. */
export function normalizeMessageId(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;
  const found = value.match(/<[^>\s]+>/);
  if (found) return found[0];
  return `<${value.replace(/^<|>$/g, '')}>`;
}

// ── Provider payloads ────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Case-insensitive header lookup across the shapes providers use for headers. */
function headerLookup(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;

  // Postmark: [{ Name, Value }]
  if (Array.isArray(raw)) {
    for (const h of raw as AnyRecord[]) {
      const name = str(h?.Name ?? h?.name);
      const value = str(h?.Value ?? h?.value);
      if (name && value !== undefined) out[name.toLowerCase()] = value;
    }
    return out;
  }

  // SendGrid: one folded string of "Name: value" lines.
  if (typeof raw === 'string') {
    for (const line of raw.split(/\r?\n(?!\s)/)) {
      const idx = line.indexOf(':');
      if (idx > 0) out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    return out;
  }

  if (typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as AnyRecord)) {
      const value = str(v);
      if (value !== undefined) out[k.toLowerCase()] = value;
    }
  }
  return out;
}

function decodeBase64(content: unknown): Buffer | null {
  const value = str(content);
  if (!value) return null;
  try {
    // Tolerate data: URLs and whitespace-wrapped base64.
    const cleaned = value.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    return Buffer.from(cleaned, 'base64');
  } catch {
    return null;
  }
}

/** Attachments carried inline in a JSON payload (our Worker, and Postmark). */
function jsonAttachments(body: AnyRecord): NormalizedAttachment[] {
  const list = (body.attachments ?? body.Attachments) as unknown;
  if (!Array.isArray(list)) return [];

  const out: NormalizedAttachment[] = [];
  for (const raw of list as AnyRecord[]) {
    const content = decodeBase64(raw.content ?? raw.Content ?? raw.contentBase64 ?? raw.data);
    if (!content || content.length === 0) continue;
    const contentId = str(raw.contentId ?? raw.ContentID ?? raw.cid)?.replace(/^<|>$/g, '');
    out.push({
      fileName: str(raw.fileName ?? raw.Name ?? raw.filename ?? raw.name) || 'attachment',
      mimeType: str(raw.mimeType ?? raw.ContentType ?? raw.contentType ?? raw.type) || 'application/octet-stream',
      content,
      contentId: contentId || undefined,
      isInline: Boolean(raw.isInline ?? raw.inline ?? (contentId && contentId.length > 0)),
    });
  }
  return out;
}

/**
 * Builds one NormalizedMail from a provider payload plus any multipart files.
 * Returns null when the payload carries no usable sender address, which is the
 * only field the rest of the pipeline cannot work without.
 */
export function normalizeInbound(body: AnyRecord, files: IncomingFile[] = []): NormalizedMail | null {
  const headers = headerLookup(body.headers ?? body.Headers);

  // The Worker sends {name, email}; everyone else sends a header string.
  const from =
    parseAddress(str(body.from)) ??
    parseAddress(str((body.from as AnyRecord)?.email)) ??
    parseAddress(str((body.From as AnyRecord)?.email)) ??
    parseAddress(str((body.FromFull as AnyRecord)?.Email)) ??
    parseAddress(str(body.From)) ??
    parseAddress(str(body.sender)) ??
    parseAddress(headers['from']);
  if (!from) return null;

  const fromName =
    str((body.from as AnyRecord)?.name) ??
    str((body.FromFull as AnyRecord)?.Name) ??
    str(body.FromName) ??
    from.name;

  const toRaw = body.to ?? body.To ?? body.recipient ?? headers['to'];
  const to = Array.isArray(toRaw)
    ? (toRaw as unknown[])
        .map((t) => (typeof t === 'string' ? parseAddress(t) : parseAddress(str((t as AnyRecord)?.email))))
        .filter((a): a is MailAddress => Boolean(a))
    : parseAddressList(str(toRaw));

  const ccRaw = body.cc ?? body.Cc ?? headers['cc'];
  const cc = Array.isArray(ccRaw)
    ? (ccRaw as unknown[])
        .map((t) => (typeof t === 'string' ? parseAddress(t) : parseAddress(str((t as AnyRecord)?.email))))
        .filter((a): a is MailAddress => Boolean(a))
    : parseAddressList(str(ccRaw));

  const text =
    str(body.text) ?? str(body.TextBody) ?? str(body['body-plain']) ?? str(body['stripped-text']);
  const html = str(body.html) ?? str(body.HtmlBody) ?? str(body['body-html']);

  // Mailgun and SendGrid post attachments as multipart files.
  const fileAttachments: NormalizedAttachment[] = files.map((f) => ({
    fileName: f.originalname || 'attachment',
    mimeType: f.mimetype || 'application/octet-stream',
    content: f.buffer,
    isInline: false,
  }));

  const spamScore =
    num(body.spamScore) ??
    num(body.SpamScore) ??
    num(headers['x-spam-score']) ??
    num(headers['x-mailgun-sscore']);

  const spamFlag = str(body.SpamStatus) ?? headers['x-spam-status'] ?? headers['x-spam-flag'];
  const isSpam =
    body.isSpam === true ||
    (spamScore !== undefined && spamScore >= 5) ||
    /^(yes|true)/i.test(spamFlag ?? '');

  return {
    messageId: normalizeMessageId(
      str(body.messageId) ?? str(body.MessageID) ?? str(body['Message-Id']) ?? headers['message-id'],
    ),
    inReplyTo: normalizeMessageId(
      str(body.inReplyTo) ?? str(body['In-Reply-To']) ?? headers['in-reply-to'],
    ),
    references: parseReferences(
      str(body.references) ?? str(body.References) ?? headers['references'],
    ),
    from: { email: from.email, name: fromName },
    to,
    cc,
    subject: (str(body.subject) ?? str(body.Subject) ?? '(no subject)').trim() || '(no subject)',
    text: text || undefined,
    html: html || undefined,
    spamScore,
    isSpam,
    headers: Object.keys(headers).length ? pickHeaders(headers) : undefined,
    sizeBytes: num(body.sizeBytes) ?? num(body.size),
    attachments: [...jsonAttachments(body), ...fileAttachments],
  };
}

/** Keeps the headers worth auditing (authentication results, routing) and drops the rest. */
function pickHeaders(headers: Record<string, string>): Record<string, string> {
  const keep = [
    'authentication-results',
    'received-spf',
    'dkim-signature',
    'return-path',
    'reply-to',
    'delivered-to',
    'x-original-to',
    'x-spam-status',
    'x-spam-score',
    'date',
    'user-agent',
    'x-mailer',
  ];
  const out: Record<string, string> = {};
  for (const k of keep) if (headers[k]) out[k] = headers[k].slice(0, 2000);
  return out;
}
