import { timingSafeEqual } from 'node:crypto';
import { getSetting, type MailSettings } from '@/lib/settings';
import { normalizeInbound, type IncomingFile } from '@/lib/mail-parse';
import { deliver } from '@/lib/mailbox';

/**
 * Where delivered mail arrives.
 *
 * Called by the provider, never by a person, so it is guarded by a shared secret
 * rather than a session. The body shape differs per provider and is normalised
 * downstream, so nothing here assumes a schema.
 */

/** Constant-time, so the secret cannot be guessed a byte at a time. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const settings = await getSetting<MailSettings>('mail');
  const expected = settings?.inboundSecret || process.env.MAIL_INBOUND_SECRET;
  if (!expected) {
    return Response.json(
      { message: 'Inbound mail is not enabled. Generate a webhook secret in Setup.' },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const provided = req.headers.get('x-mailbox-secret') ?? url.searchParams.get('secret') ?? '';
  if (!provided || !secretMatches(provided, expected)) {
    return Response.json({ message: 'Invalid webhook secret.' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  let body: Record<string, unknown> = {};
  const files: IncomingFile[] = [];

  if (contentType.includes('application/json')) {
    body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  } else if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    // SendGrid and Mailgun post forms, and SendGrid puts attachments in as files.
    const form = await req.formData();
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') {
        body[key] = value;
        continue;
      }
      files.push({
        fieldname: key,
        originalname: value.name || 'attachment',
        mimetype: value.type || 'application/octet-stream',
        size: value.size,
        buffer: Buffer.from(await value.arrayBuffer()),
      });
    }
  } else {
    body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const mail = normalizeInbound(body, files);
  if (!mail) {
    return Response.json({ message: 'Payload carried no sender address.' }, { status: 400 });
  }

  const result = await deliver(mail);
  // A 200 with delivered:false stops the provider retrying mail that will never
  // route; the Worker turns that into a bounce so the sender is told.
  return Response.json(result);
}
