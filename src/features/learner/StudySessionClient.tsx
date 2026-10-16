'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Eye, Lightbulb, Loader2, Mic, Send } from 'lucide-react';
import { loadOutbox, removeOutboxItem, saveOutboxItem } from '@/lib/outbox';
import { formatDate } from './format';

type StudyItem = {
  id: string;
  prompt: string;
  meaning: string;
  position: number;
  answered: boolean;
  form?: string;
  assessmentLocked?: boolean;
};

type Session = {
  id: string;
  userId: string;
  purpose?: string;
  setTitle: string;
  mode: 'WRITTEN' | 'SPOKEN';
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  timezone: string;
  items: StudyItem[];
  completedCount: number;
};

type Result = {
  correct: boolean | null;
  result: 'CORRECT' | 'INCORRECT' | 'ASSISTED' | 'SELF_REPORTED';
  target: string;
  acceptedAnswers: string[];
  explanation: string;
  audioUrl?: string | null;
  completed: boolean;
  nextDueAt: string | null;
  reviewStep: number | null;
  qualified: boolean;
  reviewReason: string | null;
  form?: string;
};

type Reveal = { text: string; audioUrl?: string | null };
type AnswerBody = { itemId: string; eventId: string; answer?: string; selfRating?: 'AGAIN' | 'GOOD'; hard?: boolean };
type FrozenSubmission = { body: AnswerBody; mode: 'WRITTEN' | 'SPOKEN' };

export function StudySessionClient({ session }: { session: Session }) {
  const router = useRouter();
  const firstOpen = Math.max(0, session.items.findIndex((item) => !item.answered));
  const [index, setIndex] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hardAnswers, setHardAnswers] = useState<Record<string, boolean>>({});
  const [eventIds, setEventIds] = useState<Record<string, string>>({});
  const [frozenSubmissions, setFrozenSubmissions] = useState<Record<string, FrozenSubmission>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [reveals, setReveals] = useState<Record<string, Partial<Record<'HINT' | 'ANSWER', Reveal>>>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outboxWarning, setOutboxWarning] = useState<string | null>(null);
  const [outboxCount, setOutboxCount] = useState(0);
  const pendingRef = useRef<string | null>(null);
  const retryingRef = useRef(false);
  const item = session.items[index];
  const promptRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const previousIndex = useRef(index);
  const resultForFocus = item ? results[item.id] : undefined;
  useEffect(() => {
    if (resultForFocus) resultRef.current?.focus();
    else if (previousIndex.current !== index) promptRef.current?.focus();
    previousIndex.current = index;
  }, [index, resultForFocus]);
  const progress = useMemo(
    () => new Set([...Object.keys(results), ...session.items.filter((entry) => entry.answered).map((entry) => entry.id)]).size,
    [results, session.items],
  );
  const completed = progress >= session.items.length || Object.values(results).some((result) => result.completed);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    queueMicrotask(() => {
      let restored: ReturnType<typeof loadOutbox>;
      try {
        restored = loadOutbox(session.userId, session.id);
      } catch {
        setOutboxWarning('브라우저 임시 저장소를 읽지 못했습니다. 온라인 제출은 계속 시도합니다.');
        return;
      }
      setOutboxCount(restored.length);
      if (!restored.length) return;
      setFrozenSubmissions((current) => {
        const next = { ...current };
        for (const entry of restored) next[entry.payload.itemId] = { mode: session.mode, body: entry.payload };
        return next;
      });
      setEventIds((current) => {
        const next = { ...current };
        for (const entry of restored) next[entry.payload.itemId] = entry.payload.eventId;
        return next;
      });
    });
  }, [session.id, session.mode, session.userId]);

  useEffect(() => {
    async function onOnline() {
      await retryOutbox();
    }
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  });

  function eventIdFor(itemId: string) {
    const existing = eventIds[itemId];
    if (existing) return existing;
    const next = crypto.randomUUID();
    setEventIds((current) => ({ ...current, [itemId]: next }));
    return next;
  }

  async function reveal(kind: 'HINT' | 'ANSWER') {
    if (pending) return;
    setPending(`${kind}:${item.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/v1/study-sessions/${session.id}/reveals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, kind }),
      });
      const data = (await response.json().catch(() => ({}))) as Reveal & { error?: string };
      if (!response.ok) throw new Error(data.error ?? '내용을 열지 못했습니다.');
      setReveals((current) => ({ ...current, [item.id]: { ...current[item.id], [kind]: data } }));
    } catch (revealError) {
      setError(revealError instanceof Error ? revealError.message : '내용을 열지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function submitWritten() {
    if (pending) return;
    const frozen = frozenSubmissions[item.id];
    const submission =
      frozen ??
      ({
        mode: 'WRITTEN' as const,
        body: { itemId: item.id, eventId: eventIdFor(item.id), answer: answers[item.id] ?? '', hard: hardAnswers[item.id] ?? false },
      } satisfies FrozenSubmission);
    await sendAnswer(submission);
  }

  async function submitSelfRating(selfRating: 'AGAIN' | 'GOOD') {
    if (pending) return;
    const submission =
      frozenSubmissions[item.id] ??
      ({
        mode: 'SPOKEN' as const,
        body: { itemId: item.id, eventId: eventIdFor(item.id), selfRating },
      } satisfies FrozenSubmission);
    await sendAnswer(submission);
  }

  async function sendAnswer(submission: FrozenSubmission) {
    if (pendingRef.current) return;
    const pendingKey = submission.mode === 'WRITTEN' ? `ANSWER:${submission.body.itemId}` : `RATE:${submission.body.itemId}`;
    pendingRef.current = pendingKey;
    setPending(pendingKey);
    setError(null);
    setFrozenSubmissions((current) => ({ ...current, [submission.body.itemId]: submission }));
    savePendingOutbox(submission);
    try {
      const response = await fetch(`/api/v1/study-sessions/${session.id}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission.body),
      });
      const data = (await response.json().catch(() => ({}))) as Result & { error?: string };
      if (response.ok) {
        setResults((current) => ({ ...current, [submission.body.itemId]: data }));
        removePendingOutbox(submission.body.eventId);
        setFrozenSubmissions((current) => removeKey(current, submission.body.itemId));
        return;
      }
      if (response.status === 409) {
        setError(data.error ?? '이미 저장된 답안입니다. 최신 기록을 불러옵니다.');
        removePendingOutbox(submission.body.eventId);
        setFrozenSubmissions((current) => removeKey(current, submission.body.itemId));
        router.refresh();
        return;
      }
      if (response.status >= 400 && response.status < 500) {
        setError(data.error ?? '입력값을 확인해 주세요.');
        removePendingOutbox(submission.body.eventId);
        setFrozenSubmissions((current) => removeKey(current, submission.body.itemId));
        return;
      }
      setError(data.error ?? '저장 확인이 끝나지 않았습니다. 같은 답안을 다시 전송해 주세요.');
    } catch {
      setError('저장 확인이 끝나지 않았습니다. 같은 답안을 다시 전송해 주세요.');
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  }

  async function retryOutbox() {
    if (pendingRef.current || retryingRef.current) return;
    retryingRef.current = true;
    try {
      const restored = loadSessionOutbox();
      setOutboxCount(restored.length);
      for (const entry of restored) {
        await sendAnswer({ mode: session.mode, body: entry.payload });
      }
    } finally {
      retryingRef.current = false;
    }
  }

  function loadSessionOutbox() {
    try {
      return loadOutbox(session.userId, session.id);
    } catch {
      setOutboxWarning('브라우저 임시 저장소를 읽지 못했습니다. 온라인 제출은 계속 시도합니다.');
      return [];
    }
  }

  function savePendingOutbox(submission: FrozenSubmission) {
    try {
      const existing = loadOutbox(session.userId, session.id).find((entry) => entry.payload.eventId === submission.body.eventId);
      saveOutboxItem({
        ownerId: session.userId,
        sessionId: session.id,
        payload: submission.body,
        createdAt: existing?.createdAt ?? Date.now(),
      });
      setOutboxCount(loadOutbox(session.userId, session.id).length);
      setOutboxWarning(null);
    } catch {
      setOutboxWarning('브라우저 임시 저장소에 대기 제출을 남기지 못했습니다. 네트워크가 연결되어 있으면 제출은 계속 시도합니다.');
    }
  }

  function removePendingOutbox(eventId: string) {
    try {
      removeOutboxItem(session.userId, session.id, eventId);
      setOutboxCount(loadOutbox(session.userId, session.id).length);
      setOutboxWarning(null);
    } catch {
      setOutboxWarning('브라우저 임시 저장소를 갱신하지 못했습니다. 설정에서 로그아웃하면 이 기기의 대기 제출을 정리합니다.');
    }
  }

  function discardOutbox() {
    const restored = loadSessionOutbox();
    for (const entry of restored) removePendingOutbox(entry.payload.eventId);
    setFrozenSubmissions((current) => {
      const next = { ...current };
      for (const entry of restored) delete next[entry.payload.itemId];
      return next;
    });
  }

  function renderOutboxNotice() {
    if (outboxCount <= 0) return null;
    return (
      <div className="notice">
        <p>저장 확인 대기 중인 제출 {outboxCount}개가 이 기기에 남아 있습니다.</p>
        <div className="button-row">
          <button className="button-secondary" type="button" onClick={retryOutbox} disabled={Boolean(pendingRef.current) || retryingRef.current}>
            {pending || retryingRef.current ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
            대기 제출 다시 전송
          </button>
          <button className="button-ghost" type="button" onClick={discardOutbox} disabled={Boolean(pendingRef.current) || retryingRef.current}>
            대기 제출 버리기
          </button>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <section className="empty-state">
        <strong>학습할 문장이 없습니다.</strong>
        <p>세트에 공개된 문장이 생기면 학습을 시작할 수 있습니다.</p>
      </section>
    );
  }

  if (session.status === 'ABANDONED') {
    return (
      <section className="empty-state">
        <strong>만료된 오늘 학습입니다.</strong>
        <p>새 오늘 학습 큐가 만들어져 이 세션은 더 이상 답안을 받지 않습니다.</p>
        {renderOutboxNotice()}
        {outboxWarning ? <p className="notice notice-error" role="alert">{outboxWarning}</p> : null}
        <Link className="button" href="/today">오늘 학습으로 이동</Link>
      </section>
    );
  }

  const currentResult = results[item.id];
  const currentReveal = reveals[item.id];
  const frozenSubmission = frozenSubmissions[item.id];
  const answered = item.answered || Boolean(currentResult);
  const lockedForUnresolvedSubmit = Boolean(frozenSubmission) && !answered;
  const assessmentLocked = Boolean(item.assessmentLocked && !answered);
  const isApplication = item.form === 'APPLICATION';

  return (
    <section className="card stack-lg study-card">
      <p className="sr-only" role="status">{pending ? '요청 처리 중' : currentReveal ? '도움 내용을 표시했습니다.' : ''}</p>
      <div className="split-row">
        <span className="badge">{isApplication ? '응용 평가' : session.purpose === 'ASSESSMENT' ? '회상 평가' : session.mode === 'WRITTEN' ? '입력 회상' : '말하기 자기확인'}</span>
        <span className="muted">{Math.min(progress, session.items.length)} / {session.items.length}</span>
      </div>

      <article className="card-quiet stack">
        <span className="badge badge-accent">{item.position}번째 문장</span>
        <p ref={promptRef} tabIndex={-1} className="recall-prompt" lang="ko">{item.prompt}</p>
        <p className="muted">{item.meaning}</p>
      </article>

      {session.mode === 'WRITTEN' ? (
        <div className="stack">
          <label className="field">
            내가 떠올린 영어 문장
            <textarea
              className="textarea"
              aria-describedby="answer-guidance"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={answers[item.id] ?? ''}
              onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))}
              disabled={answered || Boolean(pending) || lockedForUnresolvedSubmit}
              placeholder="힌트 없이 먼저 적어 보세요."
            />
          </label>
          <p id="answer-guidance" className="muted">{assessmentLocked ? '평가 중에는 도움을 볼 수 없어요. 답안을 적으면 제출할 수 있어요.' : '답안을 적으면 제출할 수 있어요.'}</p>
          <label className="check-line">
            <input
              type="checkbox"
              checked={hardAnswers[item.id] ?? false}
              onChange={(event) => setHardAnswers((current) => ({ ...current, [item.id]: event.target.checked }))}
              disabled={answered || Boolean(pending) || lockedForUnresolvedSubmit}
            />
            <span>정답이어도 어려웠어요</span>
          </label>
          <div className="study-actions">
            <button className="button-secondary" type="button" onClick={() => reveal('HINT')} disabled={assessmentLocked || answered || Boolean(pending) || lockedForUnresolvedSubmit}>
              {pending === `HINT:${item.id}` ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Lightbulb size={18} aria-hidden="true" />}
              힌트
            </button>
            <button className="button-secondary" type="button" onClick={() => reveal('ANSWER')} disabled={assessmentLocked || answered || Boolean(pending) || lockedForUnresolvedSubmit}>
              <Eye size={18} aria-hidden="true" /> 답 보기
            </button>
            <button className="button" type="button" onClick={submitWritten} disabled={answered || (!frozenSubmission && !answers[item.id]?.trim()) || Boolean(pending)}>
              {pending === `ANSWER:${item.id}` ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
              {frozenSubmission ? '같은 답안 다시 전송' : '제출'}
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="notice">
            <Mic size={20} aria-hidden="true" />
            <p>문장을 소리 내어 말한 뒤 답을 열어 스스로 비교해 주세요.</p>
          </div>
          <button className="button-secondary" type="button" onClick={() => reveal('ANSWER')} disabled={answered || Boolean(currentReveal?.ANSWER) || Boolean(pending) || lockedForUnresolvedSubmit}>
            {pending === `ANSWER:${item.id}` ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            답 열기
          </button>
          {currentReveal?.ANSWER ? (
            <div className="paired-actions">
              <button className="button-secondary" type="button" disabled={answered || Boolean(pending) || Boolean(frozenSubmission)} onClick={() => submitSelfRating('AGAIN')}>
                다시 볼래요
              </button>
              <button className="button" type="button" disabled={answered || Boolean(pending) || Boolean(frozenSubmission)} onClick={() => submitSelfRating('GOOD')}>
                <Check size={18} aria-hidden="true" /> 괜찮았어요
              </button>
            </div>
          ) : null}
          {frozenSubmission?.mode === 'SPOKEN' ? (
            <button className="button" type="button" disabled={Boolean(pending)} onClick={() => sendAnswer(frozenSubmission)}>
              {pending === `RATE:${item.id}` ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
              같은 확인 다시 전송
            </button>
          ) : null}
        </div>
      )}

      {item.answered && !currentResult ? <p className="notice">이미 서버에 기록된 문장입니다. 다시 제출하지 않도록 잠가 두었습니다.</p> : null}
      {renderOutboxNotice()}
      {outboxWarning ? <p className="notice notice-error" role="alert">{outboxWarning}</p> : null}
      {lockedForUnresolvedSubmit ? (
        <p className="notice" role="status">
          저장 확인 중 — 같은 답안 다시 전송
        </p>
      ) : null}
      {currentReveal?.HINT ? (
        <div className="notice">
          <strong>힌트</strong>
          <p>{currentReveal.HINT.text}</p>
          {currentReveal.HINT.audioUrl ? <audio controls src={currentReveal.HINT.audioUrl}>오디오를 재생할 수 없습니다.</audio> : null}
        </div>
      ) : null}
      {currentReveal?.ANSWER ? (
        <div className="notice">
          <strong>답</strong>
          <p className="english-phrase" lang="en">{currentReveal.ANSWER.text}</p>
          {currentReveal.ANSWER.audioUrl ? <audio controls src={currentReveal.ANSWER.audioUrl}>오디오를 재생할 수 없습니다.</audio> : null}
        </div>
      ) : null}
      {currentResult ? (
        <div className={currentResult.correct === false ? 'notice notice-error' : 'notice notice-success'}>
          <h2 ref={resultRef} tabIndex={-1}>{resultCopy(currentResult.result)}</h2>
          <p className="english-phrase" lang="en">{currentResult.target}</p>
          <p>{currentResult.explanation}</p>
          <p className="muted">
            {currentResult.form === 'APPLICATION' || currentResult.reviewReason === 'assessment-result'
              ? '평가 결과로만 저장했습니다.'
              : currentResult.nextDueAt
              ? `다음 예정 ${formatDate(currentResult.nextDueAt, session.timezone)}`
              : '다음 일정은 아직 배정되지 않았습니다.'}
          </p>
          {currentResult.form === 'APPLICATION' || currentResult.reviewReason === 'assessment-result' ? (
            <p className="muted">{currentResult.reviewReason ? reviewReasonCopy(currentResult.reviewReason) : '평가 기록'}</p>
          ) : (
            <p className="muted">
              복습 단계 {currentResult.reviewStep ?? 0} · 지연 회상 {currentResult.qualified ? '인정' : '미인정'}
              {currentResult.reviewReason ? ` · ${reviewReasonCopy(currentResult.reviewReason)}` : ''}
            </p>
          )}
          {currentResult.audioUrl ? <audio controls src={currentResult.audioUrl}>오디오를 재생할 수 없습니다.</audio> : null}
        </div>
      ) : null}
      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
      {completed ? (
        <div className="notice notice-success">
          <strong>세션 기록을 남겼어요.</strong>
          <div className="button-row">
            <Link className="button" href="/history">기록 보기</Link>
            <Link className="button-secondary" href="/today">오늘로 돌아가기</Link>
          </div>
        </div>
      ) : null}
      <div className="button-row">
        <button className="button-ghost" type="button" disabled={index === 0 || Boolean(pending) || lockedForUnresolvedSubmit} onClick={() => setIndex((current) => Math.max(0, current - 1))}>
          이전
        </button>
        <button className="button-secondary" type="button" disabled={index >= session.items.length - 1 || Boolean(pending) || lockedForUnresolvedSubmit} onClick={() => setIndex((current) => Math.min(session.items.length - 1, current + 1))}>
          다음
        </button>
      </div>
    </section>
  );
}

function resultCopy(result: Result['result']) {
  if (result === 'CORRECT') return '정답으로 기록했어요';
  if (result === 'ASSISTED') return '도움 후 답으로 기록했어요';
  if (result === 'SELF_REPORTED') return '말하기 자기확인을 기록했어요';
  return '비교가 필요해요';
}

function reviewReasonCopy(reason: string) {
  if (reason === 'written-first-success') return '첫 정답을 기록했어요. 하루 뒤 다시 떠올려 봐요';
  if (reason === 'written-qualified') return '시간이 지난 뒤에도 떠올렸어요. 다음 간격을 반영했습니다';
  if (reason === 'written-qualified-hard') return '어려움 표시로 같은 단계에 둡니다';
  if (reason === 'written-relearn') return '오답이나 도움 후 답은 하루 뒤 다시 확인합니다';
  if (reason === 'written-early-success') return '아직 복습 기한 전이라 단계를 유지합니다';
  if (reason === 'written-recent-exposure') return '최근 본 문장이라 시간을 두고 다시 확인합니다';
  if (reason === 'spoken-again') return '말하기 자기확인을 하루 뒤 다시 진행합니다';
  if (reason.startsWith('spoken-')) return '말하기는 별도 자기확인 일정으로 기록합니다';
  if (reason === 'application-result') return '응용 문항 결과로 기록했습니다';
  if (reason === 'assessment-result') return '유지 평가 결과로 기록했습니다';
  return '다음 복습 일정을 반영했습니다';
}

function removeKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
