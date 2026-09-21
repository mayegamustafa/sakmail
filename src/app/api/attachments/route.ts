import { requireUser } from '@/lib/auth';
import { accessFor } from '@/lib/mailbox';
import { isStorageConfigured, putFile } from '@/lib/storage';
import { db } from '@/lib/db';

/** Most receiving servers reject a whole message beyond about 25MB. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Uploads a file to attach to an outgoing message.
 *
 * Permission is the same one that governs sending: if you may send from an
 * address, you may attach. The row is created with no message, and is claimed by
 * the reply or the new message that goes out.
 */
export async function POST(req: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const access = await accessFor(user);
  const maySend = access.all || access.mailboxIds.some((id) => access.canSend(id));
  if (!maySend) {
    return Response.json({ message: 'You cannot send from any address.' }, { status: 403 });
  }
  if (!isStorageConfigured()) {
    return Response.json(
      { message: 'File storage is not set up. Add the R2 details, or attach a link instead.' },
      { status: 503 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    return Response.json({ message: 'No file received.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { message: `${file.name} is over 15MB. Most mail servers reject that, so attach a link instead.` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = await putFile(buffer, file.name || 'attachment', file.type, 'outbound');
  if (!key) return Response.json({ message: 'Could not store that file.' }, { status: 502 });

  // Parked without a message until something is sent with it.
  const row = await db.mailAttachment.create({
    data: {
      fileName: (file.name || 'attachment').slice(0, 250),
      mimeType: (file.type || 'application/octet-stream').slice(0, 150),
      sizeBytes: buffer.length,
      storageKey: key,
      isInline: false,
      messageId: null,
      uploadedById: user.id,
    },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
  });
  return Response.json(row);
}
