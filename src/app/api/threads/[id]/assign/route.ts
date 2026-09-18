import { requireUser } from '@/lib/auth';
import { accessFor, assignThread } from '@/lib/mailbox';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as { assignedToId?: string | null };
  const result = await assignThread(id, await accessFor(user), body.assignedToId ?? null);

  if (result.error === 'notfound') {
    return Response.json({ message: 'Conversation not found.' }, { status: 404 });
  }
  if (result.error === 'noaccess') {
    return Response.json(
      { message: 'That person does not have access to this address.' },
      { status: 400 },
    );
  }
  return Response.json(result.thread);
}
