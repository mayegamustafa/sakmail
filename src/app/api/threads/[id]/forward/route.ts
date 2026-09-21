import { requireUser } from '@/lib/auth';
import { accessFor, forward } from '@/lib/mailbox';
import { cleanRecipients } from '@/lib/input';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = cleanRecipients(body.to);
  if (!to.length) return Response.json({ message: 'Add at least one recipient.' }, { status: 400 });

  const result = await forward({
    threadId: id,
    user,
    access: await accessFor(user),
    to,
    cc: cleanRecipients(body.cc),
    bcc: cleanRecipients(body.bcc),
    note: typeof body.note === 'string' ? body.note.slice(0, 50_000) : '',
    includeAttachments: body.includeAttachments !== false,
  });

  if (result.error === 'notfound') {
    return Response.json({ message: 'Conversation not found.' }, { status: 404 });
  }
  if (result.error === 'readonly') {
    return Response.json(
      { message: 'You can read this address but not send from it.' },
      { status: 403 },
    );
  }
  if (result.error === 'norecipient') {
    return Response.json({ message: 'Add at least one recipient.' }, { status: 400 });
  }
  return Response.json(result.result);
}
