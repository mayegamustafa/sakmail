import { requireUser } from '@/lib/auth';
import { accessFor, reply } from '@/lib/mailbox';
import { cleanAttachments, cleanRecipients } from '@/lib/input';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as {
    body?: string;
    cc?: unknown;
    bcc?: unknown;
    attachments?: unknown;
  };
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return Response.json({ message: 'Write something first.' }, { status: 400 });

  const result = await reply(
    id,
    user,
    await accessFor(user),
    text.slice(0, 50_000),
    cleanRecipients(body.cc),
    cleanAttachments(body.attachments),
    cleanRecipients(body.bcc),
  );

  if (result.error === 'notfound') {
    return Response.json({ message: 'Conversation not found.' }, { status: 404 });
  }
  if (result.error === 'readonly') {
    return Response.json(
      { message: 'You can read this address but not send from it.' },
      { status: 403 },
    );
  }
  return Response.json(result.result);
}
