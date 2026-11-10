'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DevLoginButtons() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function login(role: 'USER' | 'ADMIN') {
    setPending(role);
    setError(null);
    try {
      const response = await fetch('/api/auth/dev-signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '개발 계정 로그인에 실패했습니다.');
      router.push(data.redirectTo);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '개발 계정 로그인에 실패했습니다.');
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="card stack" aria-label="개발용 빠른 로그인">
      <strong>개발용 빠른 로그인</strong>
      <p>테스트 계정으로 바로 시작하세요.</p>
      <button className="button-secondary button-full" type="button" disabled={pending !== null} onClick={() => login('USER')}>
        {pending === 'USER' ? '로그인 중…' : '사용자로 로그인'}
      </button>
      <button className="button-secondary button-full" type="button" disabled={pending !== null} onClick={() => login('ADMIN')}>
        {pending === 'ADMIN' ? '로그인 중…' : '관리자로 로그인'}
      </button>
      <button className="button-secondary button-full" type="button" disabled={pending !== null} onClick={() => login('USER')}>
        {pending === 'USER' ? '로그인 중…' : '사용자로 로그인 (추가)'}
      </button>
      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
    </section>
  );
}
