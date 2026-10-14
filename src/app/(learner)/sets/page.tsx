import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { requirePageUser } from '@/server/auth';
import { listSets } from '@/server/services/content';

export default async function SetsPage() {
  const user = await requirePageUser(false);
  const sets = await listSets(user.id);

  return (
    <>
      <PageHeader eyebrow="세트" title="학습할 문장 세트">
        공개된 세트만 표시합니다. 등록한 세트는 오늘 학습에서 이어갈 수 있습니다.
      </PageHeader>
      {sets.length ? (
        <section className="list">
          {sets.map((set) => (
            <Link className="card stack" href={`/sets/${set.id}`} key={set.id}>
              <div className="split-row">
                <span className="badge">{set.level} · {categoryCopy(set.category)}</span>
                {set.enrolled ? <span className="badge badge-accent">등록됨</span> : null}
              </div>
              <h2>{set.title}</h2>
              <p className="muted">{set.description}</p>
              <div className="split-row">
                <span className="muted">{set.sentenceCount}문장</span>
                <span className="button-secondary">자세히 <ArrowRight size={18} aria-hidden="true" /></span>
              </div>
            </Link>
          ))}
        </section>
      ) : (
        <EmptyState title="공개된 세트가 없습니다.">
          관리자가 문장 세트를 발행하면 이곳에서 등록할 수 있습니다.
        </EmptyState>
      )}
    </>
  );
}

function categoryCopy(category: string) {
  if (category === 'SITUATION') return '상황';
  if (category === 'PATTERN') return '패턴';
  return '기능';
}
