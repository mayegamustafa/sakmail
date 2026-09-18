import type { Attachment } from '@/lib/send';

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
 * Files to send, referenced by URL.
 *
 * The scheme is pinned to https because this value is handed to the mail
 * provider to fetch. Without that, a crafted `file://` would ask it to attach
 * something off a local disk.
 */
export function cleanAttachments(input: unknown): Attachment[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const out: Attachment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
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
