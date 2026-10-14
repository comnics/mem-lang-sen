import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { EnrollmentControls } from '@/features/learner/EnrollmentControls';
import { requirePageUser } from '@/server/auth';
import { getSet } from '@/server/services/content';

export default async function SetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requirePageUser(false)]);
  const set = await getSet(id, user.id).catch(() => null);
  if (!set) notFound();

  return (
    <>
      <PageHeader eyebrow={`${set.level} · ${set.sentenceCount}문장`} title={set.title}>
        {set.description}
      </PageHeader>
      <EnrollmentControls setId={set.id} enrolled={set.enrolled} paused={set.paused} />
      <section className="card stack">
        <h2>포함된 문장</h2>
        <div className="list">
          {set.items.map((item) => (
            <article className="list-row" key={item.id}>
              <span className="badge">{item.order}번째</span>
              <strong>{item.prompt}</strong>
              <p className="muted">{item.meaning}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
