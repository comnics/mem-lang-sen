import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { formatDate } from '@/features/learner/format';
import { requirePageUser } from '@/server/auth';
import { getHistory } from '@/server/services/learning';

export default async function HistoryPage() {
  const user = await requirePageUser(false);
  const history = await getHistory(user.id);

  return (
    <>
      <PageHeader eyebrow="기록" title="학습 세션 기록">
        완료와 진행 중 기록을 사실 그대로 보여줍니다. 말하기는 자기확인으로만 표시합니다.
      </PageHeader>
      <div className="button-row">
        <Link className="button-secondary" href="/calendar">달력 보기</Link>
        <Link className="button-secondary" href="/assessments">평가 보기</Link>
      </div>
      {history.length ? (
        <section className="list">
          {history.map((session) => (
            <article className="card stack" key={session.id}>
              <div className="split-row">
                <span className="badge">{session.mode === 'WRITTEN' ? '입력 회상' : '말하기 자기확인'}</span>
                <span className="muted">{formatDate(session.createdAt, session.timezone ?? 'Asia/Seoul')}</span>
              </div>
              <h2>{session.setTitle}</h2>
              {session.studyDate ? <p className="muted">시작일 {session.studyDate}</p> : null}
              <p className="muted">
                {statusCopy(session.status)} · {session.mode === 'SPOKEN' ? `자기확인 ${session.answeredCount} / ${session.totalCount}문장` : `정답 ${session.correctCount} / ${session.totalCount}`}
              </p>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState title="아직 세션 기록이 없습니다.">
          세트에서 입력 회상이나 말하기 자기확인을 시작하면 이곳에 남습니다.
        </EmptyState>
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
