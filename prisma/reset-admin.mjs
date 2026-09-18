import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

/**
 * Forces the administrator's password.
 *
 * Deliberately separate from the seed. The seed leaves an existing account alone
 * so that a redeploy can never wipe somebody's credentials, which is right for
 * every normal deploy and exactly wrong when you are locked out. This is the
 * explicit escape hatch: run it by hand, never on boot.
 *
 *   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... node prisma/reset-admin.mjs
 *
 * It also promotes the account to ADMIN, reactivates it, and ends every existing
 * session, so a forgotten browser somewhere cannot keep the old access.
 */
const db = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';

  if (!email || password.length < 8) {
    console.error(
      'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (at least 8 characters) before running this.',
    );
    process.exitCode = 1;
    return;
  }

  const user = await db.user.upsert({
    where: { email },
    update: { passwordHash: hashPassword(password), role: 'ADMIN', isActive: true },
    create: {
      email,
      passwordHash: hashPassword(password),
      firstName: 'Schools',
      lastName: 'Administrator',
      role: 'ADMIN',
    },
  });

  const { count } = await db.session.deleteMany({ where: { userId: user.id } });
  console.log(`password set for ${user.email}`);
  console.log(`role: ${user.role}, active: ${user.isActive}, sessions ended: ${count}`);
  console.log('Sign in with the password you just set, then change it in the app.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
