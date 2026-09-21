import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { isStorageConfigured, putFile } from '@/lib/storage';

/** A badge or signature is small; anything larger is a mistake, not a logo. */
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Uploads a picture that mail clients will load: a sender badge or a signature.
 *
 * Administrators only, because whatever is uploaded here goes out on the school's
 * mail and is readable by anyone who receives it.
 */
export async function POST(req: Request) {
  const { user, response } = await requireAdmin();
  if (response) return response;

  if (!isStorageConfigured()) {
    return Response.json(
      { message: 'File storage is not set up. Add the Cloudinary or R2 details first.' },
      { status: 503 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const kind = String(form?.get('kind') ?? 'avatar');

  if (!file || typeof file === 'string') {
    return Response.json({ message: 'No file received.' }, { status: 400 });
  }
  // Only real image types: this is served back with no login, so an HTML or SVG
  // file here would be a page on our own origin that anyone could plant.
  if (!ALLOWED.includes(file.type)) {
    return Response.json(
      { message: 'Use a PNG, JPG, GIF or WebP image.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ message: 'Keep it under 2MB.' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = await putFile(buffer, file.name || 'brand', file.type, 'brand');
  if (!key) return Response.json({ message: 'Could not store that image.' }, { status: 502 });

  const row = await db.brandAsset.create({
    data: {
      kind: kind === 'signature' ? 'signature' : 'avatar',
      fileName: (file.name || 'brand').slice(0, 250),
      mimeType: file.type,
      sizeBytes: buffer.length,
      storageKey: key,
      uploadedById: user.id,
    },
    select: { id: true },
  });

  // An absolute URL, because a mail client cannot resolve a relative path.
  const origin = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  const base = origin && !/^https?:\/\//i.test(origin) ? `https://${origin}` : origin;
  return Response.json({ id: row.id, url: `${base}/api/brand/${row.id}` });
}
