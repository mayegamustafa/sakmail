/**
 * Sir Apollo Kaggwa Schools — Cloudflare Email Worker
 * ---------------------------------------------
 * Receives mail for sirapollokaggwaschools.co.ug and posts it to SAK Mail.
 *
 * Paste this whole file into a Cloudflare Worker (Workers, Create, Start from
 * "Hello World", then replace the code). It has no npm dependencies, so it runs
 * straight from the dashboard editor with no build step.
 *
 * Bind two secrets on the Worker (Settings, Variables and Secrets):
 *   PORTAL_WEBHOOK_URL  https://<your-host>/api/inbound
 *   PORTAL_SECRET       the secret from Setup inside SAK Mail
 *
 * Then under Email, Email Routing, Routing rules, send each address (or the
 * catch-all) to this Worker.
 */

// Cloudflare Email Routing accepts messages up to 25MB. Anything past these
// caps is dropped from the payload rather than failing the whole delivery, so
// the message itself always reaches the portal.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export default {
  async email(message, env, ctx) {
    try {
      const raw = await streamToUint8(message.raw, message.rawSize);
      const parsed = parseMime(raw);

      const payload = {
        messageId: header(parsed.headers, 'message-id'),
        inReplyTo: header(parsed.headers, 'in-reply-to'),
        references: header(parsed.headers, 'references'),
        from: parseAddress(header(parsed.headers, 'from')) || { email: message.from },
        to: splitAddresses(header(parsed.headers, 'to'), message.to),
        cc: splitAddresses(header(parsed.headers, 'cc')),
        subject: decodeWords(header(parsed.headers, 'subject') || '(no subject)'),
        text: parsed.text || undefined,
        html: parsed.html || undefined,
        size: message.rawSize,
        headers: keepHeaders(parsed.headers),
        attachments: parsed.attachments,
      };

      const res = await fetch(env.PORTAL_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mailbox-secret': env.PORTAL_SECRET,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        // Telling the sender now is kinder than a message that silently vanishes.
        const detail = await res.text().catch(() => '');
        message.setReject(`Mailbox unavailable (${res.status}). ${detail.slice(0, 120)}`);
        return;
      }

      // The portal answers 200 with delivered:false when the address exists on
      // the domain but nobody has created a mailbox for it. Bouncing here is
      // what the sender expects, rather than the message disappearing.
      const result = await res.json().catch(() => null);
      if (result && result.delivered === false) {
        message.setReject(result.reason || 'No such recipient at this domain.');
      }
    } catch (err) {
      message.setReject(`Mailbox error: ${String(err).slice(0, 160)}`);
    }
  },
};

// ── Stream ───────────────────────────────────────────────────────────────────

async function streamToUint8(stream, hint) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(hint && hint >= total ? total : total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// ── MIME ─────────────────────────────────────────────────────────────────────

const CRLFCRLF = [13, 10, 13, 10];
const LFLF = [10, 10];

function indexOfSeq(bytes, seq, from = 0) {
  outer: for (let i = from; i <= bytes.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) if (bytes[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

function latin1(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

/** Splits one MIME entity into its unfolded headers and its raw body bytes. */
function splitEntity(bytes) {
  let idx = indexOfSeq(bytes, CRLFCRLF);
  let gap = 4;
  if (idx === -1) {
    idx = indexOfSeq(bytes, LFLF);
    gap = 2;
  }
  if (idx === -1) return { headers: parseHeaders(latin1(bytes)), body: new Uint8Array(0) };
  return {
    headers: parseHeaders(latin1(bytes.subarray(0, idx))),
    body: bytes.subarray(idx + gap),
  };
}

function parseHeaders(block) {
  const headers = {};
  // Unfold continuation lines before splitting.
  const lines = block.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n');
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    headers[name] = headers[name] ? headers[name] + ', ' + value : value;
  }
  return headers;
}

function header(headers, name) {
  return headers[name] || undefined;
}

function contentTypeOf(headers) {
  const raw = headers['content-type'] || 'text/plain';
  const type = raw.split(';')[0].trim().toLowerCase();
  const params = {};
  for (const part of raw.split(';').slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq).trim().toLowerCase()] = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, '');
  }
  return { type, params };
}

function decodeBody(body, encoding, charset) {
  const enc = (encoding || '7bit').toLowerCase();
  let bytes = body;
  if (enc === 'base64') {
    bytes = base64ToBytes(latin1(body));
  } else if (enc === 'quoted-printable') {
    bytes = quotedPrintableToBytes(latin1(body));
  }
  return { bytes, text: () => decodeText(bytes, charset) };
}

function decodeText(bytes, charset) {
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function base64ToBytes(str) {
  const clean = str.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  return btoa(latin1(bytes));
}

function quotedPrintableToBytes(str) {
  const withoutSoftBreaks = str.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    const ch = withoutSoftBreaks[i];
    if (ch === '=' && i + 2 < withoutSoftBreaks.length) {
      const hex = withoutSoftBreaks.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out.push(ch.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

/** Walks the MIME tree, collecting the best text body, HTML body and files. */
function parseMime(raw) {
  const result = { headers: {}, text: '', html: '', attachments: [] };
  let attachmentBytes = 0;

  const root = splitEntity(raw);
  result.headers = root.headers;

  walk(root.headers, root.body, false);
  return result;

  function walk(headers, body, insideAlternative) {
    const { type, params } = contentTypeOf(headers);
    const disposition = (headers['content-disposition'] || '').toLowerCase();
    const encoding = headers['content-transfer-encoding'];

    if (type.startsWith('multipart/') && params.boundary) {
      for (const part of splitParts(body, params.boundary)) {
        const entity = splitEntity(part);
        walk(entity.headers, entity.body, insideAlternative || type === 'multipart/alternative');
      }
      return;
    }

    const filename = decodeWords(
      paramValue(headers['content-disposition'], 'filename') || params.name || '',
    );
    const isAttachment = disposition.includes('attachment') || (filename && !type.startsWith('text/'));
    const contentId = (headers['content-id'] || '').replace(/^<|>$/g, '') || undefined;
    const isInline = disposition.includes('inline') && Boolean(contentId);

    if (!isAttachment && !isInline) {
      const decoded = decodeBody(body, encoding, params.charset);
      if (type === 'text/plain' && !result.text) result.text = decoded.text();
      else if (type === 'text/html' && !result.html) result.html = decoded.text();
      return;
    }

    const decoded = decodeBody(body, encoding, params.charset);
    const size = decoded.bytes.length;
    if (size === 0 || size > MAX_ATTACHMENT_BYTES) return;
    if (attachmentBytes + size > MAX_TOTAL_ATTACHMENT_BYTES) return;
    attachmentBytes += size;

    result.attachments.push({
      fileName: filename || (contentId ? `inline-${contentId}` : 'attachment'),
      mimeType: type,
      content: bytesToBase64(decoded.bytes),
      contentId,
      isInline,
    });
  }
}

function splitParts(body, boundary) {
  const marker = `--${boundary}`;
  const text = latin1(body);
  const parts = [];
  let start = text.indexOf(marker);
  if (start === -1) return parts;
  start += marker.length;

  for (;;) {
    if (text.startsWith('--', start)) break; // closing boundary
    const nl = text.indexOf('\n', start);
    if (nl === -1) break;
    const from = nl + 1;
    const next = text.indexOf(marker, from);
    if (next === -1) {
      parts.push(body.subarray(from));
      break;
    }
    // Trim the CRLF that belongs to the boundary, not to the part.
    let end = next;
    if (text[end - 1] === '\n') end--;
    if (text[end - 1] === '\r') end--;
    parts.push(body.subarray(from, end));
    start = next + marker.length;
  }
  return parts;
}

function paramValue(raw, name) {
  if (!raw) return '';
  const m = raw.match(new RegExp(name + '\\s*=\\s*"?([^";]+)"?', 'i'));
  return m ? m[1].trim() : '';
}

// ── Header values ────────────────────────────────────────────────────────────

/** Decodes RFC 2047 =?utf-8?B?...?= words, which is how non-ASCII subjects arrive. */
function decodeWords(value) {
  if (!value || value.indexOf('=?') === -1) return value;
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_all, charset, enc, data) => {
    try {
      const bytes =
        enc.toUpperCase() === 'B'
          ? base64ToBytes(data)
          : quotedPrintableToBytes(data.replace(/_/g, ' '));
      return decodeText(bytes, charset);
    } catch {
      return data;
    }
  });
}

function parseAddress(raw) {
  if (!raw) return null;
  const value = decodeWords(String(raw).trim());
  const angled = value.match(/^(.*)<([^>]+)>\s*$/);
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, '').trim();
    return { email: angled[2].trim().toLowerCase(), name: name || undefined };
  }
  const bare = value.match(/[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+/);
  return bare ? { email: bare[0].toLowerCase() } : null;
}

function splitAddresses(raw, fallback) {
  const out = [];
  const seen = new Set();
  if (raw) {
    let current = '';
    let inQuotes = false;
    let inAngle = false;
    for (const ch of String(raw)) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === '<') inAngle = true;
      else if (ch === '>') inAngle = false;
      if (ch === ',' && !inQuotes && !inAngle) {
        push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    push(current);
  }
  // The envelope recipient is authoritative for routing, so it is always present.
  if (fallback) push(fallback);
  return out;

  function push(part) {
    const addr = parseAddress(part);
    if (addr && !seen.has(addr.email)) {
      seen.add(addr.email);
      out.push(addr);
    }
  }
}

/** Keeps the headers worth auditing and drops the rest. */
function keepHeaders(headers) {
  const keep = [
    'authentication-results',
    'received-spf',
    'dkim-signature',
    'return-path',
    'reply-to',
    'date',
    'user-agent',
    'x-mailer',
  ];
  const out = {};
  for (const k of keep) if (headers[k]) out[k] = String(headers[k]).slice(0, 2000);
  return out;
}
