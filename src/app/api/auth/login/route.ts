import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { createSession, pruneExpiredSessions } from '@/lib/auth';

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (!email || !password) {
    return Response.json({ message: 'Enter your email and password.' }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });

  // The same answer whether the address is unknown or the password is wrong, so
  // this cannot be used to find out who has an account.
  const failed = Response.json({ message: 'Those details are not right.' }, { status: 401 });
  if (!user || !user.isActive) return failed;
  if (!verifyPassword(password, user.passwordHash)) return failed;

  await createSession(user.id);
  void pruneExpiredSessions();

  return Response.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  });
}
