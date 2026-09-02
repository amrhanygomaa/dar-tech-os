import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Employee onboarding · Dar Tech OS',
  description: 'Secure invitation-only employee onboarding',
  referrer: 'no-referrer',
};

export default function OnboardingLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
