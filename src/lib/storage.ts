import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';

/**
 * Attachment storage on Cloudflare R2.
 *
 * R2 is S3-compatible, so the ordinary AWS client works against it. It was
 * chosen over the alternatives for one reason beyond the free allowance: R2
 * charges nothing for egress. A school mailbox is read far more often than it is
 * written, and on most object stores that read traffic is the bill.
 *
 * Files are kept PRIVATE. The bucket is never made public, and nothing is served
 * straight from R2. Everything goes back out through a route that checks which
 * addresses the reader may work in, because an attachment on a school mailbox is
 * as likely to be a medical form or a fee statement as a photograph, and a public
 * URL is forever once it leaks.
 */

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

function client(): S3Client {
  return new S3Client({
    region: 'auto',
    // R2_ENDPOINT overrides the derived R2 host, which lets this be pointed at
    // any S3-compatible store, including a local one for testing.
    endpoint:
      process.env.R2_ENDPOINT ||
      `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });
}

/** A key that cannot collide and cannot be guessed from the file name. */
function keyFor(fileName: string, prefix: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-60);
  return `${prefix}/${Date.now()}-${randomBytes(6).toString('hex')}-${safe}`;
}

/**
 * Stores a file and returns its key, or null when storage is not set up.
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
  if (!isStorageConfigured()) return null;
  const key = keyFor(fileName, prefix);
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: content,
        ContentType: mimeType || 'application/octet-stream',
      }),
    );
    return key;
  } catch {
    return null;
  }
}

/** Reads a file back. Used by the download route and when sending it onward. */
export async function getFile(
  key: string,
): Promise<{ body: Uint8Array; contentType?: string } | null> {
  if (!isStorageConfigured()) return null;
  try {
    const res = await client().send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
    );
    const body = await res.Body?.transformToByteArray();
    if (!body) return null;
    return { body, contentType: res.ContentType };
  } catch {
    return null;
  }
}

export async function deleteFile(key: string): Promise<void> {
  if (!isStorageConfigured()) return;
  try {
    await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  } catch {
    /* a file that will not delete must not fail the action that triggered it */
  }
}
