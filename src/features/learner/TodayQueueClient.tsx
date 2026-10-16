'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarDays, Loader2, Pause, Play, RotateCcw } from 'lucide-react';
import type { StudyMode, TodayQueueDTO } from '@/domain/m4-types';
import { formatDate } from './format';

export function TodayQueueClient({ initialQueue }: { initialQueue: TodayQueueDTO }) {
  const router = useRouter();
  const [mode, setMode] = useState<StudyMode>(initialQueue.mode);
  const [queue, setQueue] = useState(initialQueue);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMode(nextMode: StudyMode) {
    if (pending || nextMode === mode) return;
    setPending(`mode:${nextMode}`);
    setError(null);
    try {
      const response = await fetch(`/api/v1/today?mode=${nextMode}`, { method: 'GET' });
      const data = (await response.json().catch(() => ({}))) as TodayQueueDTO & { error?: string };
      if (!response.ok) throw new Error(data.error ?? '오늘 학습을 불러오지 못했습니다.');
      setMode(nextMode);
      setQueue(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '오늘 학습을 불러오지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function startToday() {
    setPending('start');
    setError(null);
    try {
      const response = await fetch('/api/v1/today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? '오늘 학습을 시작하지 못했습니다.');
      router.push(`/study/${data.id}`);
      router.refresh();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '오늘 학습을 시작하지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  const action = actionState(queue);

  return (
    <section className="card stack-lg">
      <div className="split-row">
        <div>
          <span className="badge">{queue.localDate}</span>
          <h2>오늘 학습 큐</h2>
        </div>
        <Link className="button-ghost" href="/onboarding">일정 설정</Link>
      </div>

      <div className="segmented-control" role="radiogroup" aria-label="학습 모드">
        <label>
          <input type="radio" disabled={Boolean(pending)} name="todayMode" value="WRITTEN" checked={mode === 'WRITTEN'} onChange={() => loadMode('WRITTEN')} />
          <span>{pending === 'mode:WRITTEN' ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null} 입력</span>
        </label>
        <label>
          <input type="radio" disabled={Boolean(pending)} name="todayMode" value="SPOKEN" checked={mode === 'SPOKEN'} onChange={() => loadMode('SPOKEN')} />
          <span>{pending === 'mode:SPOKEN' ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null} 말하기</span>
        </label>
      </div>

      <p className="sr-only" role="status">{pending ? '학습을 불러오는 중' : ''}</p>
      <div className="stats-grid">
        <div className="stat">
          <strong>{queue.dueCount}</strong>
          <span>복습</span>
        </div>
        <div className="stat">
          <strong>{queue.overdueCount}</strong>
          <span>밀림</span>
        </div>
        <div className="stat">
          <strong>{queue.newCount}</strong>
          <span>새 문장</span>
        </div>
      </div>

      <div className="notice">
        {action.icon}
        <div>
          <strong>{action.title}</strong>
          <p className="muted">{action.description}</p>
        </div>
      </div>

      {queue.activeSessionId ? (
        <Link className="button" aria-disabled={Boolean(pending)} onClick={(event) => { if (pending) event.preventDefault(); }} href={`/study/${queue.activeSessionId}`}>
          진행 중인 오늘 학습 이어가기 <ArrowRight size={18} aria-hidden="true" />
        </Link>
      ) : (
        <button className="button" type="button" onClick={startToday} disabled={Boolean(pending) || !action.canStart}>
          {pending === 'start' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          오늘 학습 시작
        </button>
      )}

      {queue.deferredCount > 0 ? <p className="muted">오늘 시간 안에 담지 못한 문장 {queue.deferredCount}개는 다음 큐로 넘어갑니다.</p> : null}
      {queue.recovery ? <p className="notice">오랜만에 돌아온 날이라 오늘 큐는 약 {Math.ceil(queue.effectiveMinutes)}분 안에서 가볍게 시작합니다.</p> : null}
      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}

      {queue.items.length ? (
        <div className="list">
          {queue.items.map((item) => (
            <article className="list-row" key={`${item.sentenceId}-${item.kind}-${item.scheduledAt}`}>
              <div className="split-row">
                <span className={item.kind === 'REVIEW' ? 'badge badge-accent' : 'badge'}>{item.kind === 'REVIEW' ? '복습' : '새 문장'}</span>
                <span className="muted">{formatDate(item.scheduledAt, queue.timezone)}</span>
              </div>
              <strong>{item.prompt}</strong>
              <p className="muted">{item.meaning}</p>
              {item.dueAt ? <span className="muted">예정 {formatDate(item.dueAt, queue.timezone)}</span> : null}
              <span className="muted">{item.setTitle}</span>
            </article>
          ))}
        </div>
      ) : null}

      <section className="card-quiet stack">
        <div className="split-row">
          <h3>앞으로 14일</h3>
          <CalendarDays size={20} aria-hidden="true" />
        </div>
        <div className="calendar-strip">
          {queue.calendar.map((day) => (
            <div className={day.available ? 'calendar-day' : 'calendar-day calendar-day-muted'} key={day.date}>
              <strong>{formatCalendarDate(day.date)}</strong>
              <span>{day.available ? '학습일' : '쉼'}</span>
              <span>복습 {day.reviewCount}</span>
              {day.completedCount > 0 ? <span>완료 {day.completedCount}</span> : null}
            </div>
          ))}
        </div>
        <p className="muted">표시된 복습 수는 지금 배정된 예정 기준입니다. 오늘 답변 결과에 따라 앞으로의 날짜는 달라질 수 있습니다.</p>
      </section>
    </section>
  );
}

function formatCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', month: 'short', day: 'numeric', weekday: 'short' }).format(date);
}

function actionState(queue: TodayQueueDTO) {
  if (queue.paused) {
    return {
      canStart: false,
      icon: <Pause size={20} aria-hidden="true" />,
      title: '오늘 학습을 멈춰 두었습니다.',
      description: '설정에서 전체 일시정지를 해제하면 자동 큐가 다시 열립니다.',
    };
  }
  if (!queue.isStudyDay) {
    return {
      canStart: false,
      icon: <CalendarDays size={20} aria-hidden="true" />,
      title: '오늘은 계획된 학습일이 아닙니다.',
      description: queue.nextStudyAt ? `다음 학습은 ${formatDate(queue.nextStudyAt, queue.timezone)}입니다.` : '일정 설정에서 학습일을 추가할 수 있습니다.',
    };
  }
  if (queue.activeSessionId) {
    return {
      canStart: false,
      icon: <Play size={20} aria-hidden="true" />,
      title: '진행 중인 학습이 있습니다.',
      description: '오늘 만든 학습을 먼저 이어서 마치면 새 큐를 다시 확인할 수 있습니다.',
    };
  }
  if (queue.isStudyDay && queue.items.length === 0 && queue.nextStudyAt) {
    return {
      canStart: false,
      icon: <CalendarDays size={20} aria-hidden="true" />,
      title: '학습 시간이 아직 되지 않았어요.',
      description: `오늘 학습은 ${formatDate(queue.nextStudyAt, queue.timezone)}부터 시작할 수 있습니다.`,
    };
  }
  if (queue.items.length === 0) {
    const budgetDone = queue.completedToday > 0 && (queue.dueCount > 0 || queue.deferredCount > 0);
    return {
      canStart: false,
      icon: <RotateCcw size={20} aria-hidden="true" />,
      title: budgetDone ? '오늘 정한 학습 시간을 채웠습니다.' : queue.completedToday > 0 ? '오늘 큐를 마쳤습니다.' : '지금 학습할 문장이 없습니다.',
      description: budgetDone
        ? `${queue.completedToday}개를 기록했고, 남은 복습은 다음 큐로 이어집니다.`
        : queue.completedToday > 0 ? `${queue.completedToday}개를 기록했습니다.` : '세트를 등록하거나 다음 복습 시점을 기다려 주세요.',
    };
  }
  return {
    canStart: true,
    icon: <Play size={20} aria-hidden="true" />,
    title: `${queue.items.length}개 문장을 준비했습니다.`,
    description: `${Math.max(0, Math.floor(queue.remainingSeconds / 60))}분 안에서 복습과 새 문장을 섞어 진행합니다.`,
  };
}
