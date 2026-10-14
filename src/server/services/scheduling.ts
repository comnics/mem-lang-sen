import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';
import { addCalendarDays, dateStart, defaultSchedule, isStudyDate, localDate, nextStudyAt } from '@/domain/scheduling';
import { completeStudyPlanSchema, studyPlanInputSchema, type StudyPlanInput } from '@/domain/study-plan';
import type { StudyMode, StudyPlanValue, TodayQueueDTO } from '@/domain/m4-types';

type Database = Prisma.TransactionClient;
const DAY = 86_400_000;

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
    await tx.studySession.updateMany({ where: { userId, purpose: 'DAILY', status: 'ACTIVE' }, data: { status: 'ABANDONED' } });
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
    await tx.studySession.updateMany({ where: { userId, purpose: 'DAILY', status: 'ACTIVE', OR: [{ studyDate: { not: dto.localDate } }, { timezone: { not: dto.timezone } }] }, data: { status: 'ABANDONED' } });
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

type Candidate = {
  sentenceId: string; versionId: string; prompt: string; meaning: string; setTitle: string;
  kind: 'NEW' | 'REVIEW'; dueAt: Date | null; scheduledAt: Date | null; estimatedSeconds: number;
};

async function buildQueue(tx: Database, userId: string, mode: StudyMode, now: Date) {
  const storedPlan = await tx.studyPlan.findUnique({ where: { userId }, include: { exceptions: true } });
  const plan = storedPlan ? completeStudyPlanSchema.parse(storedPlan) : { ...defaultSchedule(now), displayName: '', dailyMinutes: 5 };
  const today = localDate(now, plan.timezone);
  const start = dateStart(today, plan.timezone);
  const end = dateStart(addCalendarDays(today, 1), plan.timezone);
  const calendarRule = { ...plan, paused: false };
  const slot = nextStudyAt(start, calendarRule);
  const availableDate = isStudyDate(today, plan);
  const availableNow = availableDate && Boolean(slot && slot <= now) && !plan.paused;
  const [enrollments, states, preferences, dayEvents, pendingSessions, lastEvent] = await Promise.all([
    tx.enrollment.findMany({ where: { userId, paused: false, set: { status: 'PUBLISHED' } }, orderBy: [{ createdAt: 'asc' }, { setId: 'asc' }], include: {
      set: { include: { sentences: { orderBy: { order: 'asc' }, include: { sentenceVersion: { select: { id: true, sentenceId: true, prompt: true, meaning: true } } } } } },
    } }),
    tx.userSentenceState.findMany({ where: { userId, mode } }),
    tx.userSentencePreference.findMany({ where: { userId } }),
    tx.reviewEvent.findMany({ where: { userId, performedAt: { gte: start, lt: end } }, include: { item: true } }),
    tx.studySession.findMany({ where: { userId, purpose: 'DAILY', status: 'ACTIVE', studyDate: today, timezone: plan.timezone }, orderBy: { createdAt: 'asc' }, include: { items: { where: { reviewEvent: null } } } }),
    tx.reviewEvent.findFirst({ where: { userId }, orderBy: { performedAt: 'desc' }, select: { performedAt: true } }),
  ]);
  const recovery = storedPlan?.recoveryDate === today || Boolean(lastEvent && now.getTime() - lastEvent.performedAt.getTime() >= 7 * DAY);
  const effectiveMinutes = recovery ? Math.min(plan.dailyMinutes, 3) : plan.dailyMinutes;
  const spentSeconds = dayEvents.reduce((sum, event) => sum + event.item.estimatedSeconds, 0);
  const stateById = new Map(states.map((state) => [state.sentenceId, state]));
  const preferenceById = new Map(preferences.map((preference) => [preference.sentenceId, preference]));
  const unique = new Map<string, Candidate>();
  for (const enrollment of enrollments) {
    for (const item of enrollment.set.sentences) {
      const version = item.sentenceVersion;
      if (unique.has(version.sentenceId) || preferenceById.get(version.sentenceId)?.hidden) continue;
      const state = stateById.get(version.sentenceId);
      const exposure = preferenceById.get(version.sentenceId)?.lastExposedAt;
      const dueAt = state ? state.dueAt ?? new Date(state.lastPracticedAt.getTime() + DAY) : null;
      const earliest = dueAt && mode === 'WRITTEN' && exposure ? new Date(Math.max(dueAt.getTime(), exposure.getTime() + DAY)) : dueAt;
      unique.set(version.sentenceId, {
        sentenceId: version.sentenceId, versionId: version.id, prompt: version.prompt, meaning: version.meaning, setTitle: enrollment.set.title,
        kind: state ? 'REVIEW' : 'NEW', dueAt, scheduledAt: earliest ? nextStudyAt(earliest, calendarRule) : slot,
        estimatedSeconds: state ? 30 : 60,
      });
    }
  }
  const validPending = pendingSessions.filter((session) => session.items.length > 0 && session.items.every((item) => unique.has(item.sentenceId)));
  const validPendingIds = new Set(validPending.map((session) => session.id));
  const invalidSessionIds = pendingSessions.filter((session) => !validPendingIds.has(session.id)).map((session) => session.id);
  const reservedSeconds = validPending.flatMap((session) => session.items).reduce((sum, item) => sum + item.estimatedSeconds, 0);
  let remainingSeconds = Math.max(0, effectiveMinutes * 60 - spentSeconds - reservedSeconds);
  const active = validPending.find((session) => session.mode === mode);
  const reservedIds = new Set(validPending.filter((session) => session.mode === mode).flatMap((session) => session.items.map((item) => item.sentenceId)));
  const all = [...unique.values()];
  const reviews = all.filter((item) => item.kind === 'REVIEW' && item.scheduledAt && item.scheduledAt <= now && !reservedIds.has(item.sentenceId)).sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime() || a.sentenceId.localeCompare(b.sentenceId));
  const fresh = all.filter((item) => item.kind === 'NEW' && !reservedIds.has(item.sentenceId));
  const selected: Candidate[] = [];
  if (availableNow && !active) {
    for (const item of [...reviews, ...fresh]) {
      if (item.estimatedSeconds > remainingSeconds) continue;
      selected.push({ ...item, scheduledAt: slot });
      remainingSeconds -= item.estimatedSeconds;
    }
  }
  const calendar = Array.from({ length: 14 }, (_, index) => {
    const date = addCalendarDays(today, index);
    return {
      date, available: !plan.paused && isStudyDate(date, plan),
      reviewCount: plan.paused ? 0 : all.filter((item) => item.kind === 'REVIEW' && item.scheduledAt && localDate(item.scheduledAt < start && slot ? slot : item.scheduledAt, plan.timezone) === date).length,
      completedCount: index === 0 ? dayEvents.length : 0,
    };
  });
  const dto: TodayQueueDTO = {
    mode, localDate: today, timezone: plan.timezone, paused: plan.paused, isStudyDay: availableDate,
    nextStudyAt: plan.paused || availableNow ? null : nextStudyAt(now, plan)?.toISOString() ?? null,
    dailyMinutes: plan.dailyMinutes, effectiveMinutes, recovery, completedToday: dayEvents.length,
    remainingSeconds: Math.max(0, effectiveMinutes * 60 - spentSeconds - reservedSeconds),
    dueCount: reviews.length,
    overdueCount: all.filter((item) => item.dueAt && localDate(item.dueAt, plan.timezone) < today).length,
    newCount: selected.filter((item) => item.kind === 'NEW').length,
    deferredCount: Math.max(0, reviews.length - selected.filter((item) => item.kind === 'REVIEW').length),
    activeSessionId: plan.paused ? null : active?.id ?? null,
    items: selected.map((item) => ({ sentenceId: item.sentenceId, prompt: item.prompt, meaning: item.meaning, setTitle: item.setTitle, kind: item.kind, dueAt: item.dueAt?.toISOString() ?? null, scheduledAt: item.scheduledAt!.toISOString() })),
    calendar,
  };
  return { dto, selected, invalidSessionIds };
}

async function lockUser(tx: Database, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM app."AppUser" WHERE id=${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(401, '로그인이 필요합니다.');
}
