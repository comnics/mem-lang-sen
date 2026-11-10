'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { AssessmentDTO } from '@/server/services/assessments';

type Assignment = AssessmentDTO['assignments'][number];
type SessionKind = 'WEEKLY' | 'RETENTION';

type Summary = {
  assigned: number;
  answered: number;
  inWindowAnswered: number;
  outsideWindow: number;
  missed: number;
  notStarted: number;
  correct: number;
  rate: number | null;
};

export function AssessmentsClient({ initial }: { initial: AssessmentDTO }) {
  const router = useRouter();
  const [pending, setPending] = useState<SessionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buckets = useMemo(() => ({
    retention7: initial.assignments.filter((assignment) => assignment.kind === 'RETENTION_7'),
    retention30: initial.assignments.filter((assignment) => assignment.kind === 'RETENTION_30'),
    weeklyRecall: initial.assignments.filter((assignment) => assignment.kind === 'WEEKLY' && !isApplicationPeriod(assignment.periodKey)),
    weeklyApplication: initial.assignments.filter((assignment) => assignment.kind === 'WEEKLY' && isApplicationPeriod(assignment.periodKey)),
  }), [initial.assignments]);

  async function start(kind: SessionKind) {
    if (pending) return;
    setPending(kind);
    setError(null);
    try {
      const response = await fetch('/api/v1/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? '평가를 시작하지 못했습니다.');
      router.push(`/study/${data.id}`);
      router.refresh();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '평가를 시작하지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  const retentionReady = initial.available.some((item) => item.kind === 'RETENTION_7' || item.kind === 'RETENTION_30');
  const weeklyReady = initial.canStartWeekly;
  const openAssignments = initial.assignments.filter((assignment) => assignment.status === 'NOT_STARTED' || assignment.status === 'OPEN');
  const followupCount = buckets.retention30.length;

  return (
    <section className="card stack-lg">
      <div className="split-row">
        <div>
          <span className="badge">{initial.localDate}</span>
          <h2>암기 검증</h2>
        </div>
        <span className="badge">학습 문장 {initial.cohorts.total}개</span>
      </div>

      <div className="assessment-grid">
        <Metric title="7일 유지 회상" summary={summarize(buckets.retention7)} />
        <Metric title="30일 후속 회상" summary={summarize(buckets.retention30)} />
        <Metric title="주간 누적 회상" summary={summarize(buckets.weeklyRecall)} />
        <Metric title="주간 응용" summary={summarize(buckets.weeklyApplication)} />
      </div>

      <div className="form-actions">
        <button className="button" type="button" onClick={() => start('RETENTION')} disabled={!retentionReady || Boolean(pending)}>
          {pending === 'RETENTION' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
          7/30일 유지 평가 시작
        </button>
        <button className="button-secondary" type="button" onClick={() => start('WEEKLY')} disabled={!weeklyReady || Boolean(pending)}>
          {pending === 'WEEKLY' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
          주간 누적/응용 평가 시작
        </button>
      </div>

      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}

      <section className="card-quiet stack">
        <h3>대기 중인 평가</h3>
        {openAssignments.length ? (
          <div className="list">
            {openAssignments.map((assignment) => (
              <AssignmentRow assignment={assignment} key={assignment.id} />
            ))}
          </div>
        ) : (
          <p className="muted">지금 열려 있는 평가가 없습니다. 주간 평가는 학습 기록을 기준으로 시작할 때 문항을 만듭니다.</p>
        )}
      </section>

      <section className="card-quiet stack">
        <h3>최근 결과와 놓친 평가</h3>
        {initial.recent.length ? (
          <div className="list">
            {initial.recent.map((item) => (
              <div className="list-row" key={item.id}>
                <div className="split-row">
                  <strong>{kindCopy(item.kind)}</strong>
                  <span className="badge">{item.answeredAt ? dateCopy(item.answeredAt) : '미응시 마감'}</span>
                </div>
                <span className="muted">{resultCopy(item.result, item.inWindow)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">아직 평가 결과가 없습니다.</p>
        )}
      </section>

      <p className="muted">{initial.copy.denominator}</p>
      <p className="muted">30일 지표는 노출이 없었다는 뜻이 아니라, 첫 입력 회상 이후 30일 후속 확인으로 배정된 {followupCount}개 문장의 결과입니다.</p>
      <p className="muted">{initial.copy.retention}</p>
    </section>
  );
}

function Metric({ title, summary }: { title: string; summary: Summary }) {
  return (
    <article className="metric-card">
      <strong>{title}</strong>
      <span className="metric-value">{summary.rate === null ? '-' : `${summary.rate}%`}</span>
      <span className="muted">정답 {summary.correct} / 배정 {summary.assigned}</span>
      <span className="muted">응시 {summary.answered} · 기간 내 {summary.inWindowAnswered} · 기간 밖 {summary.outsideWindow}</span>
      <span className="muted">놓침 {summary.missed} · 미시작/대기 {summary.notStarted}</span>
    </article>
  );
}

function AssignmentRow({ assignment }: { assignment: Assignment }) {
  return (
    <div className="list-row">
      <div className="split-row">
        <strong>{assignmentTitle(assignment)}</strong>
        <span className="badge">마감 {dateCopy(assignment.closesAt)}</span>
      </div>
      <p>{assignment.prompt}</p>
      <p className="muted">{assignment.meaning}</p>
      <span className="muted">
        기준 간격 {gapCopy(assignment.exposureGapHours)} · 중간 복습 {assignment.interveningReviews ?? 0}회 · 상태 {statusCopy(assignment.status)}
      </span>
    </div>
  );
}

function summarize(assignments: Assignment[]): Summary {
  const assigned = assignments.length;
  const answered = assignments.filter((assignment) => assignment.answeredAt).length;
  const inWindowAnswered = assignments.filter((assignment) => assignment.answeredAt && assignment.inWindow).length;
  const outsideWindow = assignments.filter((assignment) => assignment.answeredAt && assignment.inWindow === false).length;
  const missed = assignments.filter((assignment) => assignment.status === 'MISSED').length;
  const correct = assignments.filter((assignment) => assignment.result === 'CORRECT' && assignment.inWindow).length;
  return {
    assigned,
    answered,
    inWindowAnswered,
    outsideWindow,
    missed,
    notStarted: Math.max(0, assigned - answered - missed),
    correct,
    rate: assigned ? Math.round((correct / assigned) * 100) : null,
  };
}

function isApplicationPeriod(periodKey: string) {
  return periodKey.endsWith(':APPLICATION');
}

function assignmentTitle(assignment: Assignment) {
  if (assignment.kind === 'RETENTION_7') return '7일 유지 회상';
  if (assignment.kind === 'RETENTION_30') return '30일 후속 회상';
  return isApplicationPeriod(assignment.periodKey) ? '주간 응용' : '주간 누적 회상';
}

function kindCopy(kind: string) {
  if (kind === 'RETENTION_7') return '7일 유지 회상';
  if (kind === 'RETENTION_30') return '30일 후속 회상';
  return '주간 평가';
}

function resultCopy(result: string | null, inWindow: boolean | null) {
  if (!result) return '응시하지 않고 마감되었습니다.';
  const suffix = inWindow === false ? ' · 기간 밖 응시' : ' · 기간 내 응시';
  return `${result === 'CORRECT' ? '정답' : '오답'}${suffix}`;
}

function statusCopy(status: Assignment['status']) {
  if (status === 'OPEN') return '진행 중';
  if (status === 'NOT_STARTED') return '시작 전';
  if (status === 'UPCOMING') return '예정';
  if (status === 'MISSED') return '놓침';
  return '완료';
}

function gapCopy(value: number | null) {
  if (value === null) return '아직 없음';
  if (value < 24) return `${Math.round(value)}시간`;
  return `${Math.round(value / 24)}일`;
}

function dateCopy(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(new Date(value));
}
