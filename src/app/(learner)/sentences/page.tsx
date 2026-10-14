import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { formatDate } from '@/features/learner/format';
import { requirePageUser } from '@/server/auth';
import { getMySentences } from '@/server/services/learning';
import { getStudyPlan } from '@/server/services/scheduling';

export default async function SentencesPage() {
  const user = await requirePageUser(false);
  const plan = await getStudyPlan(user.id);
  const sentences = await getMySentences(user.id);

  return (
    <>
      <PageHeader eyebrow="내 문장" title="연습한 문장">
        입력 회상과 말하기 자기확인에서 만난 문장을 모아 보여줍니다.
      </PageHeader>
      {sentences.length ? (
        <section className="list">
          {sentences.map((sentence) => (
            <article className="card stack" key={sentence.id}>
              <div className="split-row">
                <span className="badge">{sentence.mode === 'WRITTEN' ? '입력 회상' : '말하기'}</span>
                <span className="badge badge-accent">{resultCopy(sentence.lastResult)}</span>
              </div>
              <h2>{sentence.prompt}</h2>
              <p className="muted">{sentence.meaning}</p>
              <span className="muted">최근 연습 {formatDate(sentence.lastPracticedAt, plan?.timezone)}</span>
              <span className="muted">다음 예정 {formatDate(sentence.dueAt, plan?.timezone)}</span>
              <span className="muted">복습 단계 {sentence.reviewStep} · 지연 회상 {sentence.qualifiedRecallCount}회</span>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState title="아직 연습한 문장이 없습니다." action={<Link className="button" href="/sets">세트에서 시작하기</Link>}>
          학습 세션에서 답하거나 자기확인을 남기면 이곳에 표시됩니다.
        </EmptyState>
      )}
    </>
  );
}

function resultCopy(result: string | null) {
  if (result === 'CORRECT') return '최근 정답';
  if (result === 'ASSISTED') return '최근 도움 후 답';
  if (result === 'SELF_REPORTED') return '최근 말하기';
  if (result === 'INCORRECT') return '최근 비교 필요';
  return '기록 없음';
}
