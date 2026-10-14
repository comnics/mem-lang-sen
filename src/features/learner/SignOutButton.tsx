'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    const response = await fetch('/api/auth/signout', { method: 'POST' });
    const data = (await response.json().catch(() => ({}))) as { redirectTo?: string };
    router.push(data.redirectTo ?? '/');
    router.refresh();
  }

  return (
    <button className="button-ghost" type="button" onClick={signOut} disabled={pending}>
      <LogOut size={17} aria-hidden="true" />
      {pending ? '나가는 중' : '로그아웃'}
    </button>
  );
}
