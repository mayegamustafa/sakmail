import { PrismaClient } from '@prisma/client';

/**
 * Prints what is actually in the database, so "I cannot log in" stops being a
 * guess. Deliberately shows no password material, only which accounts exist and
 * what state they are in.
 *
 *   npm run db:doctor
 */
const db = new PrismaClient();

async function main() {
  const [users, mailboxes, threads, sessions] = await Promise.all([
    db.user.findMany({
      select: {
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.mailbox.count(),
    db.mailThread.count(),
    db.session.count(),
  ]);

  console.log(`\nAccounts: ${users.length}`);
  if (users.length === 0) {
    console.log('  NONE. The seed did not run, or ran against a different database.');
    console.log('  Open /setup in a browser to create the first administrator.');
  }
  for (const u of users) {
    const admin = u.role === 'ADMIN' ? 'ADMIN' : 'staff';
    const active = u.isActive ? 'active' : 'SUSPENDED';
    const seen = u.lastLoginAt ? u.lastLoginAt.toISOString() : 'never signed in';
    console.log(`  ${u.email}`);
    console.log(`     ${admin}, ${active}, ${seen}`);
  }

  const admins = users.filter((u) => u.role === 'ADMIN' && u.isActive);
  console.log(`\nAddresses: ${mailboxes}`);
  console.log(`Conversations: ${threads}`);
  console.log(`Open sessions: ${sessions}`);

  console.log('\nWhat to do:');
  if (admins.length === 0) {
    console.log('  No active administrator. Open /setup to create one.');
  } else {
    console.log(`  Sign in as exactly one of: ${admins.map((a) => a.email).join(', ')}`);
    console.log('  Password wrong? Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, then:');
    console.log('    npm run db:reset-admin');
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error('Could not read the database:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
