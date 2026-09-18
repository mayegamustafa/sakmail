import { db } from '@/lib/db';

/**
 * True when nobody can administer this install yet.
 *
 * This is the only thing that opens the first-run setup page, and it is checked
 * on the server on every request rather than trusted from the page, because the
 * page creates an administrator without any credentials. The moment one active
 * administrator exists, that door closes permanently.
 */
export async function needsFirstRun(): Promise<boolean> {
  const admins = await db.user.count({ where: { role: 'ADMIN', isActive: true } });
  return admins === 0;
}
