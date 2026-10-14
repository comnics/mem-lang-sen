'use client';

import Link from 'next/link';

type CalendarDay = {
  date: string;
  total: number;
  writtenCorrect: number;
  assisted: number;
  wrong: number;
  spoken: number;
  application: number;
  qualified: number;
  scheduledDueCount: number;
  assessmentDueCount: number;
  utcFallbackCount: number;
};

type Assessment = {
  id: string;
  kind: string;
  periodKey: string;
  opensAt: string;
  dueAt: string;
  closesAt: string;
  answeredAt: string | null;
  result: string | null;
  href: string | null;
};

export function NewCalendarClient({ month, days, assessments }: { month: string; days: CalendarDay[]; assessments: Assessment[] }) {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return (
    <div className="stack">
      <section className="card stack">
        <div className="split-row">
          <Link className="button-secondary" href={`/calendar?month=${previous}`}>이전</Link>
          <h2>{month}</h2>
          <Link className="button-secondary" href={`/calendar?month=${next}`}>다음</Link>
        </div>
        <p className="muted">완료 기록은 제출 당시 학습일 기준입니다. 예정과 평가일은 서버 배정 시각 기준으로 표시됩니다.</p>
        <div className="calendar-strip">
          {days.map((day) => (
            <article className={`calendar-day ${day.total === 0 && day.scheduledDueCount === 0 && day.assessmentDueCount === 0 ? 'calendar-day-muted' : ''}`} key={day.date}>
              <strong>{day.date.slice(5)}</strong>
              <span>완료 {day.total} · 예정 {day.scheduledDueCount}</span>
              <span>정답 {day.writtenCorrect} · 도움 {day.assisted} · 오답 {day.wrong}</span>
              <span>말하기 {day.spoken} · 응용 {day.application}</span>
              <span>평가 {day.assessmentDueCount} · 검증 {day.qualified}</span>
              {day.utcFallbackCount ? <span>UTC 과거기록 {day.utcFallbackCount}</span> : null}
            </article>
          ))}
        </div>
      </section>
      <section className="card stack">
        <h2>평가 창</h2>
        <div className="list">
          {assessments.length ? assessments.map((assessment) => {
            const body = (
              <>
                <strong>{kindLabel(assessment.kind)}</strong>
                <span className="muted">{assessment.opensAt.slice(0, 10)} ~ {assessment.closesAt.slice(0, 10)}</span>
                <span className="badge">{assessment.answeredAt ? `응시 ${resultLabel(assessment.result)}` : '미응시'}</span>
              </>
            );
            return assessment.href ? <Link className="list-row" key={assessment.id} href={assessment.href}>{body}</Link> : <div className="list-row" key={assessment.id}>{body}</div>;
          }) : <p className="muted">열린 평가 창이 없습니다.</p>}
        </div>
      </section>
    </div>
  );
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function kindLabel(kind: string) {
  if (kind === 'RETENTION_7') return '7일 유지 평가';
  if (kind === 'RETENTION_30') return '30일 유지 평가';
  if (kind === 'WEEKLY') return '주간 누적 평가';
  return '평가';
}

function resultLabel(result: string | null) {
  if (result === 'CORRECT') return '정답';
  if (result === 'ASSISTED') return '도움 후 답';
  if (result === 'INCORRECT') return '오답';
  if (result === 'SELF_REPORTED') return '말하기 확인';
  return '기록됨';
}
