'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { clearOwnerOutbox } from '@/lib/outbox';

export function SignOutButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try { clearOwnerOutbox(userId); } catch { /* Storage can be disabled; still revoke the server session. */ }
    try {
      await unsubscribePush().catch(() => undefined);
      const response = await fetch('/api/auth/signout', { method: 'POST' });
      if (!response.ok) throw new Error('로그아웃하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
      const data = await response.json().catch(() => ({})) as { redirectTo?: string };
      router.push(data.redirectTo ?? '/');
      router.refresh();
    } catch {
      setError('로그아웃하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
      setPending(false);
    }
  }

  return (
    <>
    <button className="button-ghost" type="button" onClick={signOut} disabled={pending}>
      <LogOut size={17} aria-hidden="true" />
      {pending ? '나가는 중' : '로그아웃'}
    </button>
    {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
    </>
  );
}

async function unsubscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await fetch('/api/v1/push-subscriptions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
