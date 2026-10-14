import Link from 'next/link';
import { ArrowRight, BookOpenCheck, CalendarDays, ClipboardCheck } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { TodayQueueClient } from '@/features/learner/TodayQueueClient';
import { formatDate } from '@/features/learner/format';
import { requirePageUser } from '@/server/auth';
import { getDashboard } from '@/server/services/learning';
import { getStudyPlan, getTodayQueue } from '@/server/services/scheduling';

export default async function TodayPage() {
  const user = await requirePageUser(false);
  const [plan, dashboard] = await Promise.all([getStudyPlan(user.id), getDashboard(user.id)]);

  return (
    <>
      <PageHeader eyebrow="오늘 학습" title="오늘 떠올릴 문장">
        정답을 보기 전에 직접 쓰거나 말해 본 기록만 남깁니다.
      </PageHeader>

      <section className="stats-grid">
        <div className="stat">
          <strong>{dashboard.enrolledSets}</strong>
          <span>등록 세트</span>
        </div>
        <div className="stat">
          <strong>{dashboard.completedSessions}</strong>
          <span>완료 세션</span>
        </div>
        <div className="stat">
          <strong>{dashboard.answeredCount}</strong>
          <span>답변 기록</span>
        </div>
      </section>

      {plan ? (
        <TodayQueueClient initialQueue={await getTodayQueue(user.id, 'WRITTEN')} />
      ) : (
        <EmptyState title="학습 일정을 먼저 정해 주세요." action={<Link className="button" href="/onboarding">처음 설정하기</Link>}>
          오늘 학습 큐는 요일, 주기, 학습 시간을 저장한 뒤 만들어집니다.
        </EmptyState>
      )}

      <section className="grid-2">
        <Link className="list-row" href="/assessments">
          <ClipboardCheck size={20} aria-hidden="true" />
          <strong>평가로 확인하기</strong>
          <span className="muted">주간 응용과 7/30일 유지 평가</span>
        </Link>
        <Link className="list-row" href="/calendar">
          <CalendarDays size={20} aria-hidden="true" />
          <strong>달력 보기</strong>
          <span className="muted">날짜별 학습·평가 상태</span>
        </Link>
      </section>

      {dashboard.enrolledSets === 0 ? (
        <EmptyState
          title="아직 등록한 세트가 없습니다."
          action={<Link className="button" href="/sets">세트 고르기 <ArrowRight size={18} aria-hidden="true" /></Link>}
        >
          공개된 문장 세트를 등록하면 입력 회상이나 말하기 자기확인을 시작할 수 있습니다.
        </EmptyState>
      ) : (
        <section className="card stack">
          <div className="split-row">
            <h2>최근 학습</h2>
            <Link className="button-secondary" href="/sets">세트 보기</Link>
          </div>
          <div className="list">
            {dashboard.recentSessions.length ? dashboard.recentSessions.map((session) => (
              <Link className="list-row" key={session.id} href={`/study/${session.id}`}>
                <div className="split-row">
                  <strong>{session.setTitle}</strong>
                  <span className="badge">{session.mode === 'WRITTEN' ? '입력' : '말하기'}</span>
                </div>
                <span className="muted">{formatDate(session.createdAt, session.timezone ?? plan?.timezone)} · {statusCopy(session.status)}</span>
                {session.studyDate ? <span className="muted">시작일 {session.studyDate}</span> : null}
              </Link>
            )) : (
              <div className="empty-state">
                <BookOpenCheck size={22} aria-hidden="true" />
                <p>최근 세션이 없습니다. 등록한 세트에서 첫 학습을 시작해 보세요.</p>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function statusCopy(status: string) {
  if (status === 'COMPLETED') return '완료';
  if (status === 'ACTIVE') return '진행 중';
  if (status === 'ABANDONED') return '만료됨';
  return '기록됨';
}
