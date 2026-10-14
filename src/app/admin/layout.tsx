import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { requirePageUser } from '@/server/auth';
import { AdminShell } from '@/features/admin/admin-shell';

export const metadata: Metadata = {
  title: '관리자 | 문장정원',
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePageUser(true);

  return <AdminShell>{children}</AdminShell>;
}
