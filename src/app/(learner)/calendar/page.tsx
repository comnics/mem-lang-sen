import { PageHeader } from '@/components/PageHeader';
import { NewCalendarClient } from '@/features/learner/NewCalendarClient';
import { requirePageUser } from '@/server/auth';
import { getCalendarMonth } from '@/server/services/records';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requirePageUser(false);
  const params = await searchParams;
  const month = params.month ?? new Date().toISOString().slice(0, 7);
  const calendar = await getCalendarMonth(user.id, month);

  return (
    <>
      <PageHeader eyebrow="달력" title="날짜별 학습 기록">
        실제 제출된 기록과 7일·30일 평가 창을 함께 봅니다.
      </PageHeader>
      <NewCalendarClient month={calendar.month} days={calendar.days} assessments={calendar.assessments} />
    </>
  );
}
