import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { MailClient } from '@/components/MailClient';

export const metadata: Metadata = { title: 'Mail' };

export default async function MailPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  return <MailClient me={user} />;
}
