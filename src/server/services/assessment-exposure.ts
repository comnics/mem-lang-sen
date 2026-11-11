import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { addCalendarDays, dateStart, localDate } from '@/domain/scheduling';

export const ASSESSMENT_EXPOSURE_NOTICE = '힌트·정답을 본 문장은 해당 학습일의 평가를 미룹니다. 다음 학습일에 평가 화면에서 다시 시작해 주세요. 미응시·기간 밖 응시는 기존 기준대로 표시하며, 도움받은 답을 무도움 정답이나 오답으로 기록하지 않습니다.';

// A fresh item/version/form must not erase same-sentence priming. This is a
// conservative local-calendar-day deferral, not a claim of a 24-hour washout.
export async function exposedAssessmentSentences(tx: Prisma.TransactionClient, userId: string, now: Date, timezone: string) {
  const studyDate = localDate(now, timezone);
  const rows = await tx.exposureEvent.findMany({
    where: {
      userId,
      kind: { in: ['HINT', 'ANSWER'] },
      createdAt: { gte: dateStart(studyDate, timezone), lt: dateStart(addCalendarDays(studyDate, 1), timezone) },
    },
    select: { item: { select: { sentenceId: true } } },
  });
  return new Set(rows.map((row) => row.item.sentenceId));
}
