import { db } from '@/lib/db';
import { currentUser, requireUser } from '@/lib/auth';

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ message: 'Not signed in.' }, { status: 401 });

  const access = await db.mailboxMember.findMany({
    where: { userId: user.id },
    select: { mailboxId: true, canSend: true },
  });
  return Response.json({ ...user, mailboxAccess: access });
}

export async function PATCH(req: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

  // Deliberately cannot touch role or isActive: that is an administrator's job.
  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      firstName: str(body.firstName, 80),
      lastName: str(body.lastName, 80),
      phone: str(body.phone, 40) ?? null,
      avatarUrl: str(body.avatarUrl, 600) ?? null,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      role: true,
    },
  });
  return Response.json(updated);
}
