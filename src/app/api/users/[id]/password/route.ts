import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/lib/password';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await ctx.params;

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || password.length < 8) {
    return Response.json({ message: 'The password needs at least 8 characters.' }, { status: 400 });
  }

  await db.user.update({ where: { id }, data: { passwordHash: hashPassword(password) } });
  // Every existing session ends, so a handed-over account cannot keep the old one.
  await db.session.deleteMany({ where: { userId: id } });
  return Response.json({ updated: true });
}
