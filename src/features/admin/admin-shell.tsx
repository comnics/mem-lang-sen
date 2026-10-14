'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileUp, Gauge, LibraryBig, ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';

const navItems = [
  { href: '/admin', label: '개요', icon: Gauge },
  { href: '/admin/sets', label: '세트 관리', icon: LibraryBig },
  { href: '/admin/sentences', label: '문장 관리', icon: ListChecks },
  { href: '/admin/imports', label: 'CSV 가져오기', icon: FileUp },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-[#f6f5f0] text-[#203c32]">
      <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col md:flex-row">
        <aside className="border-b border-[#d7dfd5] bg-[#eef3ec] px-4 py-4 md:w-64 md:border-b-0 md:border-r md:px-5 md:py-6">
          <Link href="/admin" className="block rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#245d45]">
            <p className="text-sm font-semibold text-[#245d45]">문장정원</p>
            <p className="text-2xl font-bold tracking-normal">관리자</p>
          </Link>
          <nav aria-label="관리자 메뉴" className="mt-4 flex gap-2 overflow-x-auto pb-1 md:mt-8 md:flex-col md:overflow-visible md:pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    'flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#245d45]',
                    active ? 'bg-[#245d45] text-white shadow-sm' : 'text-[#385a4c] hover:bg-white',
                  ].join(' ')}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon aria-hidden="true" size={18} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
