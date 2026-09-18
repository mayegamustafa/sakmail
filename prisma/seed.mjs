import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

/**
 * Creates the first administrator and the school addresses.
 *
 * Safe to run on every boot: everything is an upsert that leaves an existing
 * row alone, so a redeploy never resets a password or undoes a change made in
 * the admin screen.
 */
const db = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const DOMAIN = 'sirapollokaggwaschools.co.ug';

/** Campuses first, then the shared departments. */
const ADDRESSES = [
  ['kisaasi', 'SAK Kisaasi'],
  ['nakasero', 'SAK Nakasero'],
  ['winston', 'SAK Winston'],
  ['mengo', 'SAK Mengo'],
  ['oldkampala', 'SAK Old Kampala'],
  ['fairways', 'SAK Fairways'],
  ['kyengera', 'SAK Kyengera'],
  ['mugongo', 'SAK Mugongo'],
  ['kitintale', 'SAK Kitintale'],
  ['kira', 'SAK Kira'],
  ['admin', 'Sir Apollo Kaggwa Schools'],
  ['feedback', 'SAK Feedback'],
  ['kjl', 'Kampala Junior League'],
];

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? `admin@${DOMAIN}`).toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const admin = await db.user.upsert({
    where: { email },
    // Nothing on update: a redeploy must not reset the password.
    update: {},
    create: {
      email,
      passwordHash: hashPassword(password),
      firstName: 'Schools',
      lastName: 'Administrator',
      role: 'ADMIN',
    },
  });
  console.log(`admin: ${admin.email}`);

  let created = 0;
  for (const [local, displayName] of ADDRESSES) {
    const address = `${local}@${DOMAIN}`;
    const existing = await db.mailbox.findUnique({ where: { address } });
    if (existing) continue;
    await db.mailbox.create({
      data: {
        address,
        displayName,
        // admin@ collects anything sent to an address nobody has created.
        isCatchAll: local === 'admin',
        sortOrder: ADDRESSES.findIndex(([l]) => l === local),
      },
    });
    created += 1;
  }
  console.log(`addresses: ${created} created, ${ADDRESSES.length - created} already there`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
