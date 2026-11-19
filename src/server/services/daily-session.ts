import 'server-only';
import { studyableSetWhere, studyableMemberWhere } from './content-access';
import type { Prisma } from '@/generated/prisma/client';
import { localDate } from '@/domain/scheduling';

// An automatic allocation belongs to one local day and currently active content.
export async function isDailySessionUsable(
  tx: Prisma.TransactionClient,
  userId: string,
  session: { purpose: string; studyDate: string | null; timezone: string },
  sentenceIds: string[],
  now: Date,
) {
  const automatic = ['DAILY', 'ASSESSMENT'].includes(session.purpose);
  const plan = await tx.studyPlan.findUnique({ where: { userId } });
  if (automatic && (!plan || plan.paused || plan.timezone !== session.timezone || session.studyDate !== localDate(now, plan.timezone))) return false;
  const [memberships, hidden] = await Promise.all([
    tx.setSentence.findMany({ where: {
      ...studyableMemberWhere(userId),
      sentenceVersion: { sentenceId: { in: sentenceIds }, sentence: { archivedAt: null, OR: [{ scope: 'PUBLIC' }, { scope: 'PERSONAL', ownerId: userId }] } },
      set: { AND: [studyableSetWhere(userId), { enrollments: { some: { userId, ...(automatic ? { paused: false } : {}) } } }, ...(automatic ? [] : [{ OR: [{ scope: 'PUBLIC' as const }, { enrollments: { some: { userId, paused: false } } }] }])] },
    }, select: { sentenceVersion: { select: { sentenceId: true } } } }),
    tx.userSentencePreference.count({ where: { userId, hidden: true, sentenceId: { in: sentenceIds } } }),
  ]);
  const available = new Set(memberships.map((membership) => membership.sentenceVersion.sentenceId));
  return hidden === 0 && sentenceIds.every((id) => available.has(id));
}
