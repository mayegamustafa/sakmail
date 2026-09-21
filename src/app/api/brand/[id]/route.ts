import { db } from '@/lib/db';
import { getFile } from '@/lib/storage';

/**
 * Serves a sender badge or signature image, with no sign-in.
 *
 * That is the point: the recipient's mail app fetches this and has no way to
 * authenticate. Only images uploaded through the admin land here, and only real
 * image types are accepted, so nothing served from this origin can be a page.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const row = await db.brandAsset.findUnique({
    where: { id },
    select: { storageKey: true, mimeType: true, fileName: true },
  });
  if (!row) return new Response('Not found', { status: 404 });

  const file = await getFile(row.storageKey);
  if (!file) return new Response('Not found', { status: 404 });

  return new Response(Buffer.from(file.body), {
    headers: {
      'content-type': row.mimeType,
      // A badge never changes once uploaded; a new one gets a new id.
      'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': `inline; filename="${row.fileName.replace(/"/g, '')}"`,
      'x-content-type-options': 'nosniff',
    },
  });
}
