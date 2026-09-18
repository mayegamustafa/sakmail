import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/lib/password';

const PUBLIC = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  return Response.json(
    await db.user.findMany({
      select: { ...PUBLIC, mailboxAccess: { select: { mailboxId: true } } },
      orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
    }),
  );
}

export async function POST(req: Request) {
  const { response } = await requireAdmin();
  if (response) return response;

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
  if (await db.user.findUnique({ where: { email } })) {
    return Response.json({ message: `${email} already has an account.` }, { status: 400 });
  }

  const created = await db.user.create({
    data: {
      email,
      firstName: firstName.slice(0, 80),
      lastName: lastName.slice(0, 80),
      phone: typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) || null : null,
      passwordHash: hashPassword(password),
      role: body.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
    },
    select: PUBLIC,
  });
  return Response.json(created);
}
