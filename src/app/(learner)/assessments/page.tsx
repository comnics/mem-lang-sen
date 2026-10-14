import { PageHeader } from '@/components/PageHeader';
import { AssessmentsClient } from '@/features/learner/AssessmentsClient';
import { requirePageUser } from '@/server/auth';
import { getAssessments } from '@/server/services/assessments';

export default async function AssessmentsPage() {
  const user = await requirePageUser(false);
  const assessments = await getAssessments(user.id);

  return (
    <>
      <PageHeader eyebrow="평가" title="정말 외웠는지 확인">
        주간 응용과 7일/30일 유지 평가를 따로 기록합니다.
      </PageHeader>
      <AssessmentsClient initial={assessments} />
    </>
  );
}
