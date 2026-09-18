import type { MailThreadState } from '@prisma/client';
import { requireUser } from '@/lib/auth';
import { accessFor, getThread, updateThread, deleteThread } from '@/lib/mailbox';

type Ctx = { params: Promise<{ id: string }> };
const missing = () => Response.json({ message: 'Conversation not found.' }, { status: 404 });

export async function GET(_req: Request, ctx: Ctx) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  const access = await accessFor(user);

  const thread = await getThread(id, access);
  if (!thread) return missing();
  // Opening a conversation marks it read, the way any mail client behaves.
  if (!thread.isRead) await updateThread(id, access, { isRead: true });
  return Response.json({ ...thread, isRead: true });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as {
    isRead?: boolean;
    isStarred?: boolean;
    state?: MailThreadState;
  };
  const data: { isRead?: boolean; isStarred?: boolean; state?: MailThreadState } = {};
  if (typeof body.isRead === 'boolean') data.isRead = body.isRead;
  if (typeof body.isStarred === 'boolean') data.isStarred = body.isStarred;
  if (body.state && ['OPEN', 'ARCHIVED', 'SPAM', 'TRASH'].includes(body.state)) data.state = body.state;
  if (Object.keys(data).length === 0) {
    return Response.json({ message: 'Nothing to update.' }, { status: 400 });
  }

  const updated = await updateThread(id, await accessFor(user), data);
  return updated ? Response.json(updated) : missing();
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  const ok = await deleteThread(id, await accessFor(user));
  return ok ? Response.json({ deleted: true }) : missing();
}
