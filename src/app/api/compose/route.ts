import { requireUser } from '@/lib/auth';
import { accessFor, compose } from '@/lib/mailbox';
import { cleanAttachments, cleanRecipients } from '@/lib/input';

export async function POST(req: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = cleanRecipients(body.to);
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';

  if (!to.length) return Response.json({ message: 'Add at least one recipient.' }, { status: 400 });
  if (!subject) return Response.json({ message: 'Add a subject.' }, { status: 400 });
  if (!text) return Response.json({ message: 'Write something first.' }, { status: 400 });

  const result = await compose({
    mailboxId: String(body.mailboxId ?? ''),
    user,
    access: await accessFor(user),
    to,
    cc: cleanRecipients(body.cc),
    subject: subject.slice(0, 300),
    body: text.slice(0, 50_000),
    attachments: cleanAttachments(body.attachments),
  });

  if (result.error === 'notfound') {
    return Response.json({ message: 'Address not found.' }, { status: 404 });
  }
  if (result.error === 'readonly') {
    return Response.json({ message: 'You cannot send from that address.' }, { status: 403 });
  }
  if (result.error === 'norecipient') {
    return Response.json({ message: 'Add at least one recipient.' }, { status: 400 });
  }
  return Response.json(result.result);
}
