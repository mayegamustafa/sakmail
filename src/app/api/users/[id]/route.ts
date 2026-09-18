import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { user, response } = await requireAdmin();
  if (response) return response;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Locking yourself out, or dropping your own admin role, would leave the
  // schools with no way back in. Refuse rather than let it happen.
  if (id === user.id) {
    if (body.isActive === false) {
      return Response.json({ message: 'You cannot suspend your own account.' }, { status: 400 });
    }
    if (body.role === 'STAFF') {
      return Response.json({ message: 'You cannot remove your own admin role.' }, { status: 400 });
    }
  }

  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? (v.trim() ? v.trim().slice(0, max) : null) : undefined;

  const updated = await db.user.update({
    where: { id },
    data: {
      ...(typeof body.firstName === 'string' && body.firstName.trim()
        ? { firstName: body.firstName.trim().slice(0, 80) }
        : {}),
      ...(typeof body.lastName === 'string' && body.lastName.trim()
        ? { lastName: body.lastName.trim().slice(0, 80) }
        : {}),
      phone: str(body.phone, 40),
      avatarUrl: str(body.avatarUrl, 600),
      ...(body.role === 'ADMIN' || body.role === 'STAFF' ? { role: body.role } : {}),
      ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
    },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
  });

  // A suspended account keeps working until its sessions are cut.
  if (body.isActive === false) await db.session.deleteMany({ where: { userId: id } });

  return Response.json(updated);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { user, response } = await requireAdmin();
  if (response) return response;
  const { id } = await ctx.params;

  if (id === user.id) {
    return Response.json({ message: 'You cannot delete your own account.' }, { status: 400 });
  }
  const remainingAdmins = await db.user.count({
    where: { role: 'ADMIN', isActive: true, id: { not: id } },
  });
  if (remainingAdmins === 0) {
    return Response.json(
      { message: 'This is the last administrator. Promote someone else first.' },
      { status: 400 },
    );
  }

  await db.user.delete({ where: { id } });
  return Response.json({ deleted: true });
}
