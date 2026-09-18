import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { needsFirstRun } from '@/lib/first-run';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  if (user) redirect('/mail');
  // A fresh install has nobody to sign in as, so send them somewhere useful
  // rather than to a form no password will open.
  redirect((await needsFirstRun()) ? '/setup' : '/sign-in');
}
