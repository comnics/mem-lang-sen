import 'server-only';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { localDate } from '@/domain/scheduling';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';

export const preferenceInputSchema = z.object({
  sentenceId: z.string().cuid(),
  hidden: z.boolean().optional(),
  note: z.string().max(1000).optional(),
  selfReportedMemorized: z.boolean().optional(),
});

export const reportInputSchema = z.object({
  sentenceVersionId: z.string().cuid(),
  reason: z.enum(['TYPO', 'ANSWER', 'AUDIO', 'MEANING', 'OTHER']),
  detail: z.string().trim().min(1).max(1000),
});

export async function updateSentencePreference(userId: string, input: z.infer<typeof preferenceInputSchema>) {
  const body = preferenceInputSchema.parse(input);
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await assertSentenceAccessible(tx, userId, body.sentenceId);
    const preference = await tx.userSentencePreference.upsert({
      where: { userId_sentenceId: { userId, sentenceId: body.sentenceId } },
      create: {
        userId,
        sentenceId: body.sentenceId,
        hidden: body.hidden ?? false,
        note: body.note ?? '',
        selfReportedMemorized: body.selfReportedMemorized ?? false,
      },
      update: {
        hidden: body.hidden,
        note: body.note,
        selfReportedMemorized: body.selfReportedMemorized,
      },
    });
    if (body.hidden) {
      await tx.studySession.updateMany({
        where: { userId, purpose: { in: ['DAILY', 'ASSESSMENT'] }, status: 'ACTIVE' },
        data: { status: 'ABANDONED' },
      });
    }
    return preferenceDto(preference);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function createContentReport(userId: string, input: z.infer<typeof reportInputSchema>) {
  const body = reportInputSchema.parse(input);
  const version = await db.sentenceVersion.findUnique({ where: { id: body.sentenceVersionId }, select: { id: true, sentenceId: true } });
  if (!version) throw new HttpError(404, '문장을 찾을 수 없습니다.');
  await assertVersionAccessible(userId, version.id);
  return db.contentReport.create({
    data: { userId, sentenceVersionId: body.sentenceVersionId, reason: body.reason, detail: body.detail },
    select: { id: true, status: true, createdAt: true },
  });
}

export async function getCalendarMonth(userId: string, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, '월 형식은 YYYY-MM이어야 합니다.');
  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 7) !== month) throw new HttpError(400, '월 형식이 올바르지 않습니다.');
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const [events, scheduledItems, assignments] = await Promise.all([
    db.reviewEvent.findMany({
      where: {
        userId,
        OR: [
          { studyDate: { startsWith: month } },
          { studyDate: null, performedAt: { gte: start, lt: next } },
        ],
      },
      orderBy: { performedAt: 'asc' },
      include: { item: { include: { session: true } } },
    }),
    db.sessionItem.findMany({
      where: {
        OR: [
          { session: { studyDate: { startsWith: month } } },
          { session: { studyDate: null }, scheduledAt: { gte: start, lt: next } },
          { scheduledAt: { gte: new Date(start.getTime() - 36 * 3_600_000), lt: new Date(next.getTime() + 36 * 3_600_000) } },
        ],
        session: { userId, purpose: { in: ['DAILY', 'ASSESSMENT'] }, status: { in: ['ACTIVE', 'COMPLETED'] } },
      },
      select: { scheduledAt: true, session: { select: { studyDate: true, timezone: true } } },
    }),
    db.assessmentAssignment.findMany({
      where: { cohort: { userId }, opensAt: { lt: next }, closesAt: { gte: start } },
      include: { cohort: true, item: { select: { sessionId: true } } },
    }),
  ]);
  const days = allMonthDays(start).map((date) => [date, emptyDay(date)] as const);
  const dayMap = new Map(days);
  for (const item of scheduledItems) {
    if (!item.scheduledAt && !item.session.studyDate) continue;
    const date = scheduledItemDate(item);
    const row = dayMap.get(date);
    if (row) row.scheduledDueCount += 1;
  }
  for (const assignment of assignments) {
    const date = assignment.dueAt.toISOString().slice(0, 10);
    const row = dayMap.get(date);
    if (row) row.assessmentDueCount += 1;
  }
  for (const event of events) {
    const date = event.studyDate ?? event.performedAt.toISOString().slice(0, 10);
    const row = dayMap.get(date);
    if (!row) continue;
    row.total += 1;
    if (!event.studyDate) row.utcFallbackCount += 1;
    if (event.form === 'APPLICATION') row.application += 1;
    else if (event.result === 'CORRECT') row.writtenCorrect += 1;
    else if (event.result === 'ASSISTED') row.assisted += 1;
    else if (event.result === 'INCORRECT') row.wrong += 1;
    else if (event.result === 'SELF_REPORTED') row.spoken += 1;
    if (event.qualified) row.qualified += 1;
  }
  return {
    month,
    days: [...dayMap.values()],
    assessments: assignments.map((assignment) => ({
      id: assignment.id,
      kind: assignment.kind,
      periodKey: assignment.periodKey,
      opensAt: assignment.opensAt.toISOString(),
      dueAt: assignment.dueAt.toISOString(),
      closesAt: assignment.closesAt.toISOString(),
      answeredAt: assignment.answeredAt?.toISOString() ?? null,
      result: assignment.result,
      sessionId: assignment.item?.sessionId ?? null,
      href: assignment.item?.sessionId ? `/study/${assignment.item.sessionId}` : null,
    })),
  };
}

export async function getAdminReports() {
  return db.contentReport.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { sentenceVersion: true, user: { select: { email: true, displayName: true } } },
    take: 100,
  });
}

export async function updateAdminReport(id: string, input: { status: 'OPEN' | 'RESOLVED' | 'DISMISSED'; resolution?: string }) {
  return db.contentReport.update({
    where: { id },
    data: { status: input.status, resolution: input.resolution ?? '' },
  });
}

export async function getQualityMetrics() {
  const [events, reports, applicationQuestions, assignments, reportTotal, recallTotal, applicationTotal] = await Promise.all([
    db.reviewEvent.groupBy({ by: ['form', 'result'], _count: { _all: true } }),
    db.contentReport.groupBy({ by: ['status'], _count: { _all: true } }),
    db.applicationQuestion.groupBy({ by: ['status'], _count: { _all: true } }),
    db.assessmentAssignment.groupBy({ by: ['kind', 'result'], _count: { _all: true } }),
    db.contentReport.count(),
    db.reviewEvent.count({ where: { form: 'RECALL' } }),
    db.reviewEvent.count({ where: { form: 'APPLICATION' } }),
  ]);
  return {
    denominators: { reports: reportTotal, recall: recallTotal, application: applicationTotal },
    events,
    reports,
    applicationQuestions,
    assignments,
  };
}

async function assertSentenceAccessible(tx: Prisma.TransactionClient, userId: string, sentenceId: string) {
  const [enrolled, practiced] = await Promise.all([
    tx.setSentence.count({
      where: { sentenceVersion: { sentenceId }, set: { status: 'PUBLISHED', enrollments: { some: { userId } } } },
    }),
    tx.reviewEvent.count({ where: { userId, item: { sentenceId } } }),
  ]);
  if (enrolled + practiced === 0) throw new HttpError(403, '접근 가능한 문장이 아닙니다.');
}

async function assertVersionAccessible(userId: string, sentenceVersionId: string) {
  const [enrolledExactVersion, practicedExactVersion] = await Promise.all([
    db.setSentence.count({
      where: {
        sentenceVersionId,
        set: { status: 'PUBLISHED', enrollments: { some: { userId } } },
      },
    }),
    db.reviewEvent.count({ where: { userId, item: { sentenceVersionId } } }),
  ]);
  if (enrolledExactVersion + practicedExactVersion === 0) throw new HttpError(403, '접근 가능한 문장 버전이 아닙니다.');
}

function preferenceDto(preference: { hidden: boolean; note: string; selfReportedMemorized: boolean; updatedAt: Date }) {
  return {
    hidden: preference.hidden,
    note: preference.note,
    selfReportedMemorized: preference.selfReportedMemorized,
    updatedAt: preference.updatedAt.toISOString(),
  };
}

function allMonthDays(start: Date) {
  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor.getUTCMonth() === start.getUTCMonth()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function emptyDay(date: string) {
  return {
    date,
    total: 0,
    writtenCorrect: 0,
    assisted: 0,
    wrong: 0,
    spoken: 0,
    application: 0,
    qualified: 0,
    scheduledDueCount: 0,
    assessmentDueCount: 0,
    utcFallbackCount: 0,
  };
}

function scheduledItemDate(item: { scheduledAt: Date | null; session: { studyDate: string | null; timezone: string } }) {
  if (item.session.studyDate) return item.session.studyDate;
  if (item.scheduledAt) return localDate(item.scheduledAt, item.session.timezone);
  return '';
}

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM app."AppUser"
    WHERE id = ${userId}::uuid
    FOR UPDATE
  `;
  if (!rows.length) throw new HttpError(401, '로그인이 필요합니다.');
}
