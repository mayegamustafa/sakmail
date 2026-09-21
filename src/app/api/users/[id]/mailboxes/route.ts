import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

/**
 * Sets which addresses one person may work in.
 *
 * The inverse of the members route on an address. Both exist because both
 * questions get asked: "who works in Kisaasi" when setting up an address, and
 * "which addresses does Grace handle" when setting up a person. Without this,
 * adding a member of staff meant creating them, then opening every address in
 * turn to tick them in.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await ctx.params;

  const user = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return Response.json({ message: 'Account not found.' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { mailboxes?: unknown };
  const raw = Array.isArray(body.mailboxes) ? body.mailboxes : [];

  const wanted: { mailboxId: string; canSend: boolean }[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const mailboxId = typeof item.mailboxId === 'string' ? item.mailboxId : '';
    if (!mailboxId || seen.has(mailboxId)) continue;
    seen.add(mailboxId);
    wanted.push({ mailboxId, canSend: item.canSend !== false });
    if (wanted.length >= 50) break;
  }

  // Only addresses that exist, so a bad id cannot leave a dangling row.
  const valid = wanted.length
    ? await db.mailbox.findMany({
        where: { id: { in: wanted.map((w) => w.mailboxId) } },
        select: { id: true },
      })
    : [];
  const allowed = new Set(valid.map((v) => v.id));
  const final = wanted.filter((w) => allowed.has(w.mailboxId));

  await db.$transaction([
    db.mailboxMember.deleteMany({
      where: { userId: id, mailboxId: { notIn: final.map((f) => f.mailboxId) } },
    }),
    ...final.map((f) =>
      db.mailboxMember.upsert({
        where: { mailboxId_userId: { mailboxId: f.mailboxId, userId: id } },
        update: { canSend: f.canSend },
        create: { mailboxId: f.mailboxId, userId: id, canSend: f.canSend },
      }),
    ),
  ]);

  const rows = await db.mailboxMember.findMany({
    where: { userId: id },
    include: { mailbox: { select: { id: true, address: true, displayName: true } } },
  });
  return Response.json(rows);
}
