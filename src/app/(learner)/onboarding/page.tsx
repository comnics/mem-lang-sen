import { PageHeader } from '@/components/PageHeader';
import { OnboardingForm } from '@/features/learner/OnboardingForm';
import { requirePageUser } from '@/server/auth';
import { getStudyPlan } from '@/server/services/scheduling';

export default async function OnboardingPage() {
  const user = await requirePageUser(false);
  const studyPlan = await getStudyPlan(user.id);

  return (
    <>
      <PageHeader eyebrow="처음 설정" title="학습 리듬을 정해요">
        요일별, 주기별, 예외 날짜를 정해 오늘 학습 큐를 만듭니다.
      </PageHeader>
      <OnboardingForm displayName={user.displayName} studyPlan={studyPlan} />
    </>
  );
}
