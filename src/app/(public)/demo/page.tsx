import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { DemoStudy } from '@/features/learner/DemoStudy';

export default function DemoPage() {
  return (
    <main className="public-shell stack-lg">
      <nav className="topbar" aria-label="공개 메뉴">
        <Logo />
        <Link className="button-ghost" href="/">
          <ChevronLeft size={18} aria-hidden="true" /> 홈
        </Link>
      </nav>
      <DemoStudy />
    </main>
  );
}
