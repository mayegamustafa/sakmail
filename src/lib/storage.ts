import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Attachment storage, with two interchangeable backends.
 *
 * Cloudinary is the default because its free plan needs no payment method on
 * file, which R2 does even though R2's free tier costs nothing. R2 is the better
 * long-term home, mainly because it charges nothing for reading files back and a
 * mailbox is read far more often than it is written.
 *
 * Which one is used is decided by whichever credentials are present, so moving
 * from one to the other is four environment variables and a redeploy. Nothing in
 * the database or the routes changes, because a stored reference records which
 * backend produced it.
 *
 * Either way files are PRIVATE in the sense that matters: nothing is ever served
 * from the provider to a browser. Every read goes back out through a route that
 * checks which addresses the reader may work in. An attachment on a school
 * mailbox is as likely to be a medical form or a fee statement as a photograph.
 */

type Backend = 'r2' | 'cloudinary' | null;

export function activeBackend(): Backend {
  if (
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  ) {
    return 'r2';
  }
  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    return 'cloudinary';
  }
  return null;
}

export function isStorageConfigured(): boolean {
  return activeBackend() !== null;
}

// ── Cloudflare R2 ────────────────────────────────────────────────────────────

function r2(): S3Client {
  return new S3Client({
    region: 'auto',
    // R2_ENDPOINT overrides the derived host, which lets this point at any
    // S3-compatible store, including a local one for testing.
    endpoint:
      process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });
}

// ── Cloudinary ───────────────────────────────────────────────────────────────

/**
 * Cloudinary signs an upload with a SHA-1 of the alphabetically sorted
 * parameters plus the api_secret, so the secret itself never leaves the server.
 */
async function cloudinaryUpload(
  content: Buffer,
  fileName: string,
  mimeType: string,
  prefix: string,
): Promise<string | null> {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME as string;
  const key = process.env.CLOUDINARY_API_KEY as string;
  const secret = process.env.CLOUDINARY_API_SECRET as string;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `sakmail/${prefix}`;
  // Random, so the address cannot be guessed from the file name.
  const publicId = `${randomBytes(12).toString('hex')}`;
  const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = createHash('sha1').update(toSign + secret).digest('hex');

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(content)], { type: mimeType }), fileName);
  form.append('api_key', key);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', publicId);
  form.append('signature', signature);

  try {
    // resource_type auto handles documents and images alike.
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/auto/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { secure_url?: string; url?: string };
    const url = data.secure_url ?? data.url;
    return url ?? null;
  } catch {
    return null;
  }
}

// ── The interface the rest of the app uses ───────────────────────────────────

/** A key that cannot collide and cannot be guessed from the file name. */
function keyFor(fileName: string, prefix: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-60);
  return `${prefix}/${Date.now()}-${randomBytes(6).toString('hex')}-${safe}`;
}

/**
 * Stores a file and returns a reference, or null when storage is not set up.
 *
 * The reference records its backend, so a mailbox that moves from Cloudinary to
 * R2 can still read everything stored before the move.
 *
 * Null rather than throwing: an attachment must never cost the school the
 * message it came with. A delivery that fails because a bucket is misconfigured
 * loses mail, which is far worse than losing the file.
 */
export async function putFile(
  content: Buffer,
  fileName: string,
  mimeType: string,
  prefix = 'mail',
): Promise<string | null> {
  const backend = activeBackend();

  if (backend === 'r2') {
    const key = keyFor(fileName, prefix);
    try {
      await r2().send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
          Body: content,
          ContentType: mimeType || 'application/octet-stream',
        }),
      );
      return `r2:${key}`;
    } catch {
      return null;
    }
  }

  if (backend === 'cloudinary') {
    const url = await cloudinaryUpload(content, fileName, mimeType, prefix);
    return url ? `cld:${url}` : null;
  }

  return null;
}

/** Reads a file back, whichever backend holds it. */
export async function getFile(
  reference: string,
): Promise<{ body: Uint8Array; contentType?: string } | null> {
  // A Cloudinary URL is a capability: it is held server side, handed to nobody,
  // and every read is checked here first.
  if (reference.startsWith('cld:')) {
    try {
      const res = await fetch(reference.slice(4), { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      return {
        body: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? undefined,
      };
    } catch {
      return null;
    }
  }

  // Bare keys predate the prefix and are always R2.
  const key = reference.startsWith('r2:') ? reference.slice(3) : reference;
  if (!process.env.R2_BUCKET) return null;
  try {
    const res = await r2().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    const body = await res.Body?.transformToByteArray();
    if (!body) return null;
    return { body, contentType: res.ContentType };
  } catch {
    return null;
  }
}
