import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
export function studyableSetWhere(userId: string): Prisma.StudySetWhereInput {
  return { OR: [{ scope: 'PUBLIC', status: 'PUBLISHED' }, { scope: 'PERSONAL', ownerId: userId, status: 'ACTIVE' }] };
}
export function studyableSentenceWhere(userId: string): Prisma.SentenceWhereInput {
  return { archivedAt: null, OR: [{ scope: 'PUBLIC' }, { scope: 'PERSONAL', ownerId: userId }] };
}
export function studyableMemberWhere(userId: string): Prisma.SetSentenceWhereInput {
  return { sentenceVersion: { sentence: studyableSentenceWhere(userId) } };
}
export function canStudySet(userId: string, set: { scope: string; ownerId: string | null; status: string }) {
  return (set.scope === 'PUBLIC' && set.status === 'PUBLISHED') || (set.scope === 'PERSONAL' && set.ownerId === userId && set.status === 'ACTIVE');
}
