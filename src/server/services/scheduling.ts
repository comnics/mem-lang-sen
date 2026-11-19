import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';
import { addCalendarDays, dateStart, defaultSchedule, localDate } from '@/domain/scheduling';
import { completeStudyPlanSchema, studyPlanInputSchema, type StudyPlanInput } from '@/domain/study-plan';
import type { StudyMode, StudyPlanValue, TodayQueueDTO } from '@/domain/m4-types';
import { calculateTodayQueue } from '@/domain/today-queue';

type Database = Prisma.TransactionClient;

export async function getStudyPlan(userId: string): Promise<StudyPlanValue | null> {
  const plan = await db.studyPlan.findUnique({ where: { userId }, include: { exceptions: { orderBy: { date: 'asc' } } } });
  return plan ? completeStudyPlanSchema.parse(plan) : null;
}

export async function updateStudyPlan(userId: string, input: StudyPlanInput, now = new Date()) {
  const parsed = studyPlanInputSchema.parse(input);
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.studyPlan.findUnique({ where: { userId }, include: { exceptions: true } });
    const initialDate = localDate(now, parsed.timezone);
    const value = completeStudyPlanSchema.parse({ ...defaultSchedule(now), startDate: initialDate, anchorDate: initialDate, ...existing, ...parsed });
    const { exceptions, ...data } = value;
    await tx.studyPlan.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await tx.scheduleException.deleteMany({ where: { userId } });
    if (exceptions.length) await tx.scheduleException.createMany({ data: exceptions.map((exception) => ({ userId, ...exception })) });
    await tx.appUser.update({ where: { id: userId }, data: { displayName: data.displayName, onboarded: true } });
    // Rebuild future allocations after a rule/budget change; submitted events stay immutable.
    await tx.studySession.updateMany({ where: { userId, purpose: { in: ['DAILY', 'ASSESSMENT'] }, status: 'ACTIVE' }, data: { status: 'ABANDONED' } });
    return { ok: true };
  });
}

export async function getTodayQueue(userId: string, mode: StudyMode = 'WRITTEN', now = new Date()): Promise<TodayQueueDTO> {
  return (await buildQueue(db, userId, mode, now)).dto;
}

export async function createTodaySession(userId: string, mode: StudyMode = 'WRITTEN', clock?: Date) {
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const now = clock ?? new Date();
    if (!await tx.studyPlan.findUnique({ where: { userId }, select: { userId: true } })) {
      const { exceptions: _exceptions, ...rule } = defaultSchedule(now);
      void _exceptions;
      const user = await tx.appUser.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
      await tx.studyPlan.create({ data: { userId, ...rule, displayName: user.displayName || '학습자', dailyMinutes: 5 } });
    }
    const { dto, selected, invalidSessionIds } = await buildQueue(tx, userId, mode, now);
    if (dto.paused) throw new HttpError(409, '학습 일정이 잠시 멈춰 있어요. 설정에서 다시 시작해 주세요.');
    if (invalidSessionIds.length) await tx.studySession.updateMany({ where: { userId, id: { in: invalidSessionIds }, status: 'ACTIVE' }, data: { status: 'ABANDONED' } });
    if (dto.activeSessionId) return { id: dto.activeSessionId };
    if (!selected.length) throw new HttpError(409, '지금 배정할 학습이 없습니다. 오늘 화면에서 다음 일정을 확인해 주세요.');
    await tx.studySession.updateMany({ where: { userId, purpose: { in: ['DAILY', 'ASSESSMENT'] }, status: 'ACTIVE', OR: [{ studyDate: { not: dto.localDate } }, { timezone: { not: dto.timezone } }] }, data: { status: 'ABANDONED' } });
    if (dto.recovery) await tx.studyPlan.updateMany({ where: { userId }, data: { recoveryDate: dto.localDate } });
    const session = await tx.studySession.create({
      data: {
        userId, mode, purpose: 'DAILY', studyDate: dto.localDate, timezone: dto.timezone, createdAt: now,
        items: { create: selected.map((item, index) => ({
          sentenceId: item.sentenceId, sentenceVersionId: item.versionId, prompt: item.prompt, meaning: item.meaning,
          position: index + 1, dueAt: item.dueAt, scheduledAt: item.scheduledAt, estimatedSeconds: item.estimatedSeconds,
        })) },
      }, select: { id: true },
    });
    return session;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 });
}

async function buildQueue(tx: Database, userId: string, mode: StudyMode, now: Date) {
  const storedPlan = await tx.studyPlan.findUnique({ where: { userId }, include: { exceptions: true } });
  const plan = storedPlan ? completeStudyPlanSchema.parse(storedPlan) : { ...defaultSchedule(now), displayName: '', dailyMinutes: 5 };
  const today = localDate(now, plan.timezone);
  const start = dateStart(today, plan.timezone);
  const end = dateStart(addCalendarDays(today, 1), plan.timezone);
  const [enrollments, states, preferences, dayEvents, pendingSessions, lastEvent] = await Promise.all([
    tx.enrollment.findMany({ where: { userId, paused: false, set: { status: 'PUBLISHED' } }, orderBy: [{ createdAt: 'asc' }, { setId: 'asc' }], include: {
      set: { include: { sentences: { orderBy: { order: 'asc' }, include: { sentenceVersion: { select: { id: true, sentenceId: true, prompt: true, meaning: true } } } } } },
    } }),
    tx.userSentenceState.findMany({ where: { userId, mode } }),
    tx.userSentencePreference.findMany({ where: { userId } }),
    tx.reviewEvent.findMany({ where: { userId, performedAt: { gte: start, lt: end } }, include: { item: true } }),
    tx.studySession.findMany({ where: { userId, purpose: { in: ['DAILY', 'ASSESSMENT'] }, status: 'ACTIVE', studyDate: today, timezone: plan.timezone }, orderBy: { createdAt: 'asc' }, include: { items: { where: { reviewEvent: null } } } }),
    tx.reviewEvent.findFirst({ where: { userId }, orderBy: { performedAt: 'desc' }, select: { performedAt: true } }),
  ]);
  return calculateTodayQueue({
    plan: { ...plan, recoveryDate: storedPlan?.recoveryDate }, mode, now,
    enrollments, states, preferences, dayEvents, pendingSessions, lastEvent,
  });
}

async function lockUser(tx: Database, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM app."AppUser" WHERE id=${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(401, '로그인이 필요합니다.');
}
