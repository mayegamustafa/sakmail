import type { MailThreadState } from '@prisma/client';
import { requireUser } from '@/lib/auth';
import { accessFor, listThreads } from '@/lib/mailbox';

const STATES = ['OPEN', 'ARCHIVED', 'SPAM', 'TRASH'];

export async function GET(req: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const q = new URL(req.url).searchParams;
  const state = q.get('state');
  const data = await listThreads(
    {
      mailboxId: q.get('mailboxId') || undefined,
      state: state && STATES.includes(state) ? (state as MailThreadState) : undefined,
      starred: q.get('starred') === 'true',
      sent: q.get('sent') === 'true',
      search: q.get('search') || undefined,
      take: Number(q.get('take')) || undefined,
      skip: Number(q.get('skip')) || undefined,
    },
    await accessFor(user),
  );
  return Response.json(data);
}
