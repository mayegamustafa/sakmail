import { PrismaClient } from '@prisma/client';
/**
 * Creates the school addresses.
 *
 * It deliberately does NOT create an administrator any more. A seeded password
 * is only knowable if you happened to see the variable at the moment it first
 * ran, and because the seed must never overwrite an existing password on a
 * redeploy, setting that variable later changed nothing. The result was an
 * account nobody could sign in to. The first administrator is now created at
 * /setup, in a browser, by whoever opens the site first.
 *
 * Safe to run on every boot: every write is an upsert that leaves an existing
 * row alone, so a redeploy never undoes a change made in the app.
 */
const db = new PrismaClient();

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

  const admins = await db.user.count({ where: { role: 'ADMIN', isActive: true } });
  console.log(
    admins === 0
      ? 'no administrator yet: open /setup in a browser to create the first one'
      : `administrators: ${admins}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
