import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { createSession } from '@/lib/auth';
import { needsFirstRun } from '@/lib/first-run';

/**
 * Creates the very first administrator, with no credentials required.
 *
 * Open only while the install has no active administrator. Checked here rather
 * than only on the page, since a page check protects nobody: this endpoint is
 * reachable directly.
 */
export async function POST(req: Request) {
  if (!(await needsFirstRun())) {
    return Response.json(
      { message: 'This install already has an administrator. Sign in instead.' },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email ?? '').trim().toLowerCase();
  const firstName = String(body.firstName ?? '').trim();
  const lastName = String(body.lastName ?? '').trim();
  const password = String(body.password ?? '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ message: 'That is not a valid email address.' }, { status: 400 });
  }
  if (!firstName || !lastName) {
    return Response.json({ message: 'Add a first and last name.' }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ message: 'The password needs at least 8 characters.' }, { status: 400 });
  }

  // The seed may already have made this account with a password nobody knows,
  // which is exactly how people end up here. Take it over rather than failing on
  // the unique address.
  const user = await db.user.upsert({
    where: { email },
    update: {
      passwordHash: hashPassword(password),
      firstName: firstName.slice(0, 80),
      lastName: lastName.slice(0, 80),
      role: 'ADMIN',
      isActive: true,
    },
    create: {
      email,
      passwordHash: hashPassword(password),
      firstName: firstName.slice(0, 80),
      lastName: lastName.slice(0, 80),
      role: 'ADMIN',
    },
  });

  await db.session.deleteMany({ where: { userId: user.id } });
  await createSession(user.id);

  return Response.json({ id: user.id, email: user.email, role: user.role });
}
