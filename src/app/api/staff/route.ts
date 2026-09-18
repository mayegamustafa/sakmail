import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

/** Who a conversation may be handed to: administrators, plus anyone with an address. */
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  const people = await db.user.findMany({
    where: {
      isActive: true,
      OR: [{ role: 'ADMIN' }, { mailboxAccess: { some: {} } }],
    },
    select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
    orderBy: { firstName: 'asc' },
  });
  return Response.json(people);
}
