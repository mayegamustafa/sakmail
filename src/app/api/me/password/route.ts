import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';

/**
 * Changes your own password.
 *
 * The current password is required, so someone who walks up to an unlocked
 * screen cannot lock the owner out of their own account.
 *
 * Every other session ends, because a password change usually means you think
 * somebody else has it. This browser is deliberately kept, so changing it does
 * not sign you out of the thing you are using.
 */
export async function POST(req: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { currentPassword, newPassword } = (await req.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return Response.json({ message: 'Enter your current and new password.' }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return Response.json({ message: 'The new password needs at least 8 characters.' }, { status: 400 });
  }

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!row || !verifyPassword(currentPassword, row.passwordHash)) {
    return Response.json({ message: 'Your current password is not right.' }, { status: 400 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword) },
  });

  const token = (await cookies()).get('sak_session')?.value;
  const { count } = await db.session.deleteMany({
    where: { userId: user.id, ...(token ? { token: { not: token } } : {}) },
  });

  return Response.json({ changed: true, otherSessionsEnded: count });
}
