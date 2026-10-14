import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StudySessionClient } from '@/features/learner/StudySessionClient';
import { requirePageUser } from '@/server/auth';
import { getSession } from '@/server/services/learning';

export default async function StudySessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requirePageUser(false)]);
  const session = await getSession(user.id, id).catch(() => null);
  if (!session) notFound();

  return (
    <>
      <PageHeader eyebrow={session.setTitle} title={session.mode === 'WRITTEN' ? '입력 회상' : '말하기 자기확인'}>
        {session.mode === 'WRITTEN'
          ? '먼저 쓴 뒤 제출하면 비교할 답과 설명을 보여줍니다.'
          : '말한 뒤 답을 열고 스스로 다시 볼지 표시합니다.'}
      </PageHeader>
      <StudySessionClient session={session} />
    </>
  );
}
