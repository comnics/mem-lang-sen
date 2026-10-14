import Link from 'next/link';
import { Settings } from 'lucide-react';
import { LogoStatic } from '@/components/Logo';
import { LearnerNav } from '@/features/learner/LearnerNav';
import { requirePageUser } from '@/server/auth';

export default async function LearnerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requirePageUser(false);

  return (
    <div className="app-shell">
      <header className="topbar">
        <LogoStatic />
        <Link className="button-ghost" href="/settings" aria-label="설정">
          <Settings size={18} aria-hidden="true" />
          <span>{user.displayName ?? '설정'}</span>
        </Link>
      </header>
      <main className="app-main">{children}</main>
      <LearnerNav />
    </div>
  );
}
