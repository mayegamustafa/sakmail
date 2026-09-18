import { requireUser } from '@/lib/auth';
import { accessFor, counts } from '@/lib/mailbox';

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  return Response.json(await counts(await accessFor(user)));
}
