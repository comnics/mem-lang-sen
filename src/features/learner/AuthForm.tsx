'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

type AuthMode = 'signin' | 'signup' | 'forgot' | 'update-password';

export function AuthForm({ mode, initialMessage = null }: { mode: AuthMode; initialMessage?: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(Array.from(form.entries()).filter(([, value]) => String(value).trim() !== ''));

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string; redirectTo?: string };
      if (!response.ok) throw new Error(data.error ?? '요청을 처리하지 못했습니다.');
      if (data.redirectTo) {
        router.push(data.redirectTo);
        router.refresh();
        return;
      }
      setMessage(data.message ?? '요청을 완료했습니다.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '요청을 처리하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }

  const needsEmail = mode !== 'update-password';
  const needsName = mode === 'signup';
  const needsPassword = mode === 'signin' || mode === 'signup' || mode === 'update-password';
  const buttonCopy = {
    signin: '로그인',
    signup: '가입 메일 받기',
    forgot: '재설정 메일 받기',
    'update-password': '새 비밀번호 저장',
  }[mode];

  return (
    <form className="card stack" onSubmit={submit}>
      {needsName ? (
        <label className="field">
          이름
          <input className="input" name="displayName" autoComplete="name" maxLength={80} />
        </label>
      ) : null}
      {needsEmail ? (
        <label className="field">
          이메일
          <input className="input" name="email" type="email" autoComplete="email" required />
        </label>
      ) : null}
      {needsPassword ? (
        <label className="field">
          비밀번호
          <input
            className="input"
            name="password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signin' ? 1 : 10}
            required
          />
        </label>
      ) : null}
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      <button className="button button-full" type="submit" disabled={pending}>
        {pending ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
        {buttonCopy}
      </button>
    </form>
  );
}
