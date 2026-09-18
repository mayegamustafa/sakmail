import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { SignInForm } from '@/components/SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage() {
  if (await currentUser()) redirect('/mail');
  return <SignInForm />;
}
