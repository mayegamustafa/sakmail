import { cookies, headers } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import type { Role } from '@prisma/client';

const COOKIE = 'sak_session';
const DAYS = 30;

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: Role;
};

/**
 * A server-stored session rather than a self-contained token.
 *
 * A signed token cannot be revoked before it expires, so suspending somebody or
 * handing their account over would leave their old browser working. Deleting the
 * row ends it immediately, which is what "sign out everywhere" has to mean.
 */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000);
  const headerList = await headers();

  await db.session.create({
    data: {
      token,
      userId,
      expiresAt,
      userAgent: headerList.get('user-agent')?.slice(0, 300) ?? null,
      ip: (headerList.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
    },
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { token } });
  jar.delete(COOKIE);
}

/** The signed-in person, or null. Expired and suspended accounts count as null. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          role: true,
          isActive: true,
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;

  const { isActive, ...user } = session.user;
  void isActive;
  return user;
}

/** For route handlers: the user, or a 401 to return. */
export async function requireUser(): Promise<
  { user: SessionUser; response?: never } | { user?: never; response: Response }
> {
  const user = await currentUser();
  if (!user) {
    return {
      response: Response.json({ message: 'Sign in to continue.' }, { status: 401 }),
    };
  }
  return { user };
}

export async function requireAdmin(): Promise<
  { user: SessionUser; response?: never } | { user?: never; response: Response }
> {
  const result = await requireUser();
  if (result.response) return result;
  if (result.user.role !== 'ADMIN') {
    return {
      response: Response.json({ message: 'Only an administrator can do that.' }, { status: 403 }),
    };
  }
  return result;
}

/** Sessions that have run out, cleared opportunistically on sign in. */
export async function pruneExpiredSessions(): Promise<void> {
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
