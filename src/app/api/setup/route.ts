import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSetting, type MailSettings } from '@/lib/settings';
import { verifySending } from '@/lib/send';

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const [settings, sending, mailboxCount] = await Promise.all([
    getSetting<MailSettings>('mail'),
    verifySending(),
    db.mailbox.count(),
  ]);

  const origin = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  // A URL with no scheme is not one the Worker's fetch can use, and it would
  // fail at delivery time rather than here.
  const base = origin && !/^https?:\/\//i.test(origin) ? `https://${origin}` : origin;

  return Response.json({
    // The secret itself is never returned; it is shown once, at rotation.
    inboundReady: Boolean(settings?.inboundSecret || process.env.MAIL_INBOUND_SECRET),
    sendingReady: sending.ok,
    sendingError: sending.ok ? undefined : sending.error,
    mailboxCount,
    webhookUrl: base ? `${base}/api/inbound` : null,
  });
}
