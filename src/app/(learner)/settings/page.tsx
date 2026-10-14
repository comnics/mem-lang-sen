import { PageHeader } from '@/components/PageHeader';
import { OnboardingForm } from '@/features/learner/OnboardingForm';
import { SignOutButton } from '@/features/learner/SignOutButton';
import { requirePageUser } from '@/server/auth';
import { getStudyPlan } from '@/server/services/scheduling';

export default async function SettingsPage() {
  const user = await requirePageUser(false);
  const studyPlan = await getStudyPlan(user.id);

  return (
    <>
      <PageHeader eyebrow="설정" title="계정과 학습 설정">
        계정 정보와 기본 선호 설정을 관리합니다.
      </PageHeader>
      <section className="card stack">
        <div>
          <strong>{user.displayName ?? '이름 없음'}</strong>
          <p className="muted">{user.email}</p>
        </div>
        <div className="divider" />
        <div className="button-row">
          <SignOutButton />
        </div>
      </section>
      <OnboardingForm displayName={user.displayName} studyPlan={studyPlan} />
    </>
  );
}
