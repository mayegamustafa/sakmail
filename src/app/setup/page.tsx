import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { needsFirstRun } from '@/lib/first-run';
import { FirstRunSetup } from '@/components/FirstRunSetup';

export const metadata: Metadata = { title: 'Set up' };
export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  // Closed for good once anybody can administer this install.
  if (!(await needsFirstRun())) redirect('/sign-in');
  return <FirstRunSetup />;
}
