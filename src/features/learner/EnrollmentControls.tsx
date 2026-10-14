'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookMarked, Loader2, Pause, Play, RotateCcw } from 'lucide-react';

export function EnrollmentControls({ setId, enrolled, paused }: { setId: string; enrolled: boolean; paused: boolean }) {
  const router = useRouter();
  const [isEnrolled, setIsEnrolled] = useState(enrolled);
  const [isPaused, setIsPaused] = useState(paused);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateEnrollment(next: boolean) {
    setPending('enroll');
    setError(null);
    try {
      const response = await fetch('/api/v1/enrollments', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setId }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? '세트 상태를 바꾸지 못했습니다.');
      setIsEnrolled(next);
      if (next) setIsPaused(false);
    } catch (enrollError) {
      setError(enrollError instanceof Error ? enrollError.message : '세트 상태를 바꾸지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function start(mode: 'WRITTEN' | 'SPOKEN') {
    setPending(mode);
    setError(null);
    try {
      const response = await fetch('/api/v1/study-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setId, mode }),
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? '학습을 시작하지 못했습니다.');
      router.push(`/study/${data.id}`);
      router.refresh();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '학습을 시작하지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function updatePause(next: boolean) {
    setPending('pause');
    setError(null);
    try {
      const response = await fetch('/api/v1/enrollments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setId, paused: next }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? '세트 일시정지를 바꾸지 못했습니다.');
      setIsPaused(next);
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : '세트 일시정지를 바꾸지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="card stack">
      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
      {isEnrolled && isPaused ? (
        <p className="notice">이 세트는 오늘 자동 큐에서 제외됩니다. 아래 버튼으로 수동 학습은 계속 시작할 수 있습니다.</p>
      ) : null}
      <div className="button-row">
        <button className="button-secondary" type="button" disabled={Boolean(pending)} onClick={() => updateEnrollment(!isEnrolled)}>
          {pending === 'enroll' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <BookMarked size={18} aria-hidden="true" />}
          {isEnrolled ? '등록 해제' : '내 세트로 등록'}
        </button>
        {isEnrolled ? (
          <button className="button-secondary" type="button" disabled={Boolean(pending)} onClick={() => updatePause(!isPaused)}>
            {pending === 'pause' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : isPaused ? <RotateCcw size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
            {isPaused ? '자동 큐 재개' : '자동 큐 일시정지'}
          </button>
        ) : null}
        <button className="button" type="button" disabled={!isEnrolled || Boolean(pending)} onClick={() => start('WRITTEN')}>
          {pending === 'WRITTEN' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          입력 회상
        </button>
        <button className="button-secondary" type="button" disabled={!isEnrolled || Boolean(pending)} onClick={() => start('SPOKEN')}>
          {pending === 'SPOKEN' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          말하기 자기확인
        </button>
      </div>
      {!isEnrolled ? <p className="muted">학습을 시작하려면 먼저 이 세트를 내 세트로 등록해 주세요.</p> : null}
    </section>
  );
}
