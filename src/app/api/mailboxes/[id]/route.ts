import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.isCatchAll) {
    await db.mailbox.updateMany({
      where: { isCatchAll: true, id: { not: id } },
      data: { isCatchAll: false },
    });
  }

  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? (v.trim() ? v.trim().slice(0, max) : null) : undefined;

  const updated = await db.mailbox.update({
    where: { id },
    data: {
      ...(typeof body.address === 'string'
        ? { address: body.address.trim().toLowerCase() }
        : {}),
      ...(typeof body.displayName === 'string' && body.displayName.trim()
        ? { displayName: body.displayName.trim().slice(0, 120) }
        : {}),
      description: str(body.description, 300),
      avatarUrl: str(body.avatarUrl, 600),
      signature: str(body.signature, 2000),
      ...(typeof body.isCatchAll === 'boolean' ? { isCatchAll: body.isCatchAll } : {}),
      ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
      ...(typeof body.autoReplyEnabled === 'boolean'
        ? { autoReplyEnabled: body.autoReplyEnabled }
        : {}),
      autoReplySubject: str(body.autoReplySubject, 200),
      autoReplyBody: str(body.autoReplyBody, 4000),
    },
  });
  return Response.json(updated);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await ctx.params;

  // Deleting cascades to every conversation in it, so the count is surfaced and
  // the screen confirms against it.
  const threads = await db.mailThread.count({ where: { mailboxId: id } });
  await db.mailbox.delete({ where: { id } });
  return Response.json({ deleted: true, threadsRemoved: threads });
}
