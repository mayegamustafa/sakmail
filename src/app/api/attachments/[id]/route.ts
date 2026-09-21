import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { accessFor } from '@/lib/mailbox';
import { getFile } from '@/lib/storage';

/**
 * Serves one attachment.
 *
 * Nothing is served straight from the bucket. An attachment on a school mailbox
 * is as likely to be a medical form or a fee statement as a photograph, so the
 * reader is checked against the addresses they may work in, exactly as the
 * conversation itself is. A public bucket URL cannot be taken back once it
 * leaks; this can.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;

  const row = await db.mailAttachment.findUnique({
    where: { id },
    select: {
      fileName: true,
      mimeType: true,
      storageKey: true,
      message: { select: { thread: { select: { mailboxId: true } } } },
    },
  });

  const missing = () => Response.json({ message: 'File not found.' }, { status: 404 });
  if (!row?.storageKey) return missing();

  // A file still parked from an upload has no message yet; only its uploader
  // could know the id, and it is claimed within the same compose.
  const mailboxId = row.message?.thread.mailboxId;
  if (mailboxId) {
    const access = await accessFor(user);
    // The same answer as a missing file, so this cannot be used to discover
    // which attachments exist in another address.
    if (!access.all && !access.mailboxIds.includes(mailboxId)) return missing();
  }

  const file = await getFile(row.storageKey);
  if (!file) return missing();

  return new Response(Buffer.from(file.body), {
    headers: {
      'content-type': file.contentType || row.mimeType || 'application/octet-stream',
      // attachment, not inline: a browser rendering someone else's HTML or SVG
      // from our own origin is a cross-site scripting hole.
      'content-disposition': `attachment; filename="${row.fileName.replace(/"/g, '')}"`,
      'cache-control': 'private, max-age=600',
      'x-content-type-options': 'nosniff',
    },
  });
}
