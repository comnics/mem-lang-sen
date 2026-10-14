'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Clock3, Home, Library } from 'lucide-react';

const items = [
  { href: '/today', label: '오늘', icon: Home },
  { href: '/sets', label: '세트', icon: BookOpen },
  { href: '/sentences', label: '내 문장', icon: Library },
  { href: '/history', label: '기록', icon: Clock3 },
];

export function LearnerNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="학습 메뉴">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} className="nav-item" href={item.href} aria-current={active ? 'page' : undefined}>
            <Icon size={19} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
