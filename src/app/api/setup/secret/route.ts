import { randomBytes } from 'node:crypto';
import { requireAdmin } from '@/lib/auth';
import { getSetting, setSetting, type MailSettings } from '@/lib/settings';

export async function POST() {
  const { response } = await requireAdmin();
  if (response) return response;

  const secret = randomBytes(24).toString('base64url');
  const current = (await getSetting<MailSettings>('mail')) ?? {};
  await setSetting<MailSettings>('mail', { ...current, inboundSecret: secret });

  return Response.json({ secret });
}
