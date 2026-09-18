import { db } from '@/lib/db';
import { requireUser, requireAdmin } from '@/lib/auth';
import { accessFor } from '@/lib/mailbox';

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const access = await accessFor(user);

  const boxes = await db.mailbox.findMany({
    where: access.all ? {} : { id: { in: access.mailboxIds } },
    include: {
      members: {
        select: {
          userId: true,
          canSend: true,
          user: { select: { firstName: true, lastName: true, email: true, avatarUrl: true } },
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { address: 'asc' }],
  });
  return Response.json(boxes);
}

export async function POST(req: Request) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const address = String(body.address ?? '').trim().toLowerCase();
  const displayName = String(body.displayName ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return Response.json({ message: 'That is not a valid address.' }, { status: 400 });
  }
  if (!displayName) return Response.json({ message: 'Add a display name.' }, { status: 400 });

  if (await db.mailbox.findUnique({ where: { address } })) {
    return Response.json({ message: `${address} already exists.` }, { status: 400 });
  }
  // Only one catch-all can win, so a new one retires the old.
  if (body.isCatchAll) {
    await db.mailbox.updateMany({ where: { isCatchAll: true }, data: { isCatchAll: false } });
  }

  const created = await db.mailbox.create({
    data: {
      address,
      displayName: displayName.slice(0, 120),
      description: str(body.description, 300),
      avatarUrl: str(body.avatarUrl, 600),
      signature: str(body.signature, 2000),
      isCatchAll: Boolean(body.isCatchAll),
      isActive: body.isActive !== false,
      sortOrder: Number(body.sortOrder) || 0,
      autoReplyEnabled: Boolean(body.autoReplyEnabled),
      autoReplySubject: str(body.autoReplySubject, 200),
      autoReplyBody: str(body.autoReplyBody, 4000),
    },
  });
  return Response.json(created);
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}
