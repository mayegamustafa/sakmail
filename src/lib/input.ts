import type { OutgoingAttachment } from '@/lib/mailbox';

const EMAIL = /^[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+$/;

/** Valid, de-duplicated, lowercased addresses, capped so one request cannot fan out. */
export function cleanRecipients(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,;\s]+/)
      : [];

  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const email = value.trim().toLowerCase();
    if (EMAIL.test(email)) seen.add(email);
    if (seen.size >= 20) break;
  }
  return [...seen];
}

/**
 * Files to send: either an id from the upload route, or an outside https link.
 *
 * The scheme is pinned to https because a link is handed to the mail provider to
 * fetch. Without that, a crafted `file://` would ask it to attach something off
 * a local disk.
 */
export function cleanAttachments(input: unknown): OutgoingAttachment[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const out: OutgoingAttachment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;

    const id = typeof item.attachmentId === 'string' ? item.attachmentId.trim() : '';
    if (id) {
      out.push({ attachmentId: id.slice(0, 60) });
      if (out.length >= 10) break;
      continue;
    }

    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const fileName = typeof item.fileName === 'string' ? item.fileName.trim() : '';
    if (!/^https:\/\//i.test(url) || !fileName) continue;
    out.push({
      url: url.slice(0, 1000),
      fileName: fileName.slice(0, 250),
      mimeType: typeof item.mimeType === 'string' ? item.mimeType.slice(0, 150) : undefined,
    });
    if (out.length >= 10) break;
  }
  return out.length ? out : undefined;
}
