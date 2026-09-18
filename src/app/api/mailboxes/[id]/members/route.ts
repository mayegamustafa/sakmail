import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

/** Replaces the whole member list for an address in one call. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await ctx.params;

  const mailbox = await db.mailbox.findUnique({ where: { id }, select: { id: true } });
  if (!mailbox) return Response.json({ message: 'Address not found.' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { members?: unknown };
  const raw = Array.isArray(body.members) ? body.members : [];

  const wanted: { userId: string; canSend: boolean }[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const userId = typeof item.userId === 'string' ? item.userId : '';
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    wanted.push({ userId, canSend: item.canSend !== false });
    if (wanted.length >= 50) break;
  }

  await db.$transaction([
    db.mailboxMember.deleteMany({
      where: { mailboxId: id, userId: { notIn: wanted.map((m) => m.userId) } },
    }),
    ...wanted.map((m) =>
      db.mailboxMember.upsert({
        where: { mailboxId_userId: { mailboxId: id, userId: m.userId } },
        update: { canSend: m.canSend },
        create: { mailboxId: id, userId: m.userId, canSend: m.canSend },
      }),
    ),
  ]);

  const members = await db.mailboxMember.findMany({
    where: { mailboxId: id },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
    },
  });
  return Response.json(members);
}
