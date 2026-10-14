import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import {
  ASSESSMENT_ITEM_LIMIT,
  WEEKLY_APPLICATION_LIMIT,
  WEEKLY_RECALL_LIMIT,
  assessmentResult,
  deterministicSample,
  isInAssessmentWindow,
  retentionWindows,
  weeklyWindow,
  type AssessmentForm,
  type AssessmentKind,
  type AssessmentResult,
  type AssessmentSessionKind,
} from '@/domain/assessment';
import { addCalendarDays, dateStart, isStudyDate, localDate, nextStudyAt } from '@/domain/scheduling';
import { completeStudyPlanSchema } from '@/domain/study-plan';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';

type Database = Prisma.TransactionClient;
type StudyMode = 'WRITTEN' | 'SPOKEN';
type ReviewResult = 'CORRECT' | 'INCORRECT' | 'ASSISTED' | 'SELF_REPORTED';
type AssessmentAssignmentWithCohort = Prisma.AssessmentAssignmentGetPayload<{ include: { cohort: true } }>;

export type AssessmentStats = {
  assigned: number;
  started: number;
  notStarted: number;
  answered: number;
  inWindowCorrect: number;
  incorrect: number;
  missed: number;
  outside: number;
  pct: { numerator: number; denominator: number; value: number | null };
};

export type AssessmentDTO = {
  generatedAt: string;
  localDate: string;
  canStartWeekly: boolean;
  cohorts: { total: number; unstarted: number };
  stats: AssessmentStats;
  summary: {
    retention7: AssessmentSummary;
    retention30: AssessmentSummary;
    weekly: AssessmentSummary;
  };
  available: { id: string; kind: AssessmentKind; dueAt: string; closesAt: string }[];
  recent: { id: string; kind: AssessmentKind; result: AssessmentResult | null; inWindow: boolean | null; answeredAt: string | null }[];
  copy: { denominator: string; retention: string };
  assignments: {
    id: string;
    kind: AssessmentKind;
    periodKey: string;
    sentenceId: string;
    prompt: string;
    meaning: string;
    opensAt: string;
    dueAt: string;
    closesAt: string;
    started: boolean;
    answeredAt: string | null;
    result: AssessmentResult | null;
    inWindow: boolean | null;
    exposureGapHours: number | null;
    interveningReviews: number | null;
    status: 'NOT_STARTED' | 'OPEN' | 'ANSWERED' | 'MISSED' | 'UPCOMING';
  }[];
};

type AssessmentSummary = {
  assigned: number;
  attempted: number;
  correct: number;
  missed: number;
  outsideWindow: number;
  notStarted: number;
  rate: number | null;
};

export async function registerCohort(tx: Database, userId: string, sentenceIds: string[], now = new Date()) {
  const uniqueIds = [...new Set(sentenceIds)];
  if (!uniqueIds.length) return { created: 0 };
  const result = await tx.assessmentCohort.createMany({
    data: uniqueIds.map((sentenceId) => ({ userId, sentenceId, selectedAt: now })),
    skipDuplicates: true,
  });
  return { created: result.count };
}

export async function recordAssessmentAnswer(
  tx: Database,
  input: {
    userId: string;
    itemId: string;
    sentenceId: string;
    versionId: string;
    eventId: string;
    result: ReviewResult;
    mode: StudyMode;
    form: string;
    performedAt: Date;
    previousExposureAt: Date | null;
  },
) {
  if (input.mode !== 'WRITTEN') return { recorded: 0 };

  const form = input.form === 'APPLICATION' ? 'APPLICATION' : 'RECALL';
  const cohort = await ensureCohortStarted(tx, input.userId, input.sentenceId, input.versionId, form, input.performedAt);
  const assignments = await tx.assessmentAssignment.findMany({ where: { sessionItemId: input.itemId, answeredAt: null } });
  if (!assignments.length) return { recorded: 0, cohortId: cohort.id };

  const interveningReviews = await tx.reviewEvent.count({
    where: {
      userId: input.userId,
      id: { not: input.eventId },
      performedAt: { lt: input.performedAt, ...(cohort.startedAt ? { gt: cohort.startedAt } : {}) },
      item: { sentenceId: input.sentenceId },
    },
  });
  const exposureGapHours = input.previousExposureAt
    ? Math.max(0, (input.performedAt.getTime() - input.previousExposureAt.getTime()) / 3_600_000)
    : null;
  const result = assessmentResult(input.result);

  for (const assignment of assignments) {
    await tx.assessmentAssignment.update({
      where: { id: assignment.id },
      data: {
        answeredAt: input.performedAt,
        result,
        inWindow: isInAssessmentWindow(input.performedAt, assignment.opensAt, assignment.closesAt),
        exposureGapHours,
        interveningReviews,
      },
    });
  }

  return { recorded: assignments.length, cohortId: cohort.id };
}

export async function getAssessments(userId: string, now = new Date()): Promise<AssessmentDTO> {
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await backfillCohorts(tx, userId);
    const assignments = await tx.assessmentAssignment.findMany({
      where: { cohort: { userId } },
      orderBy: [{ opensAt: 'asc' }, { dueAt: 'asc' }],
      include: { cohort: true, item: { select: { prompt: true, meaning: true } } },
    });
    const cohorts = await tx.assessmentCohort.findMany({ where: { userId }, select: { startedAt: true } });
    const canStartWeekly = await canCreateWeeklyAssessment(tx, userId);
    const versions = await presentationVersions(tx, userId, assignments);
    const dtoAssignments = assignments.map((assignment) => {
      const version = versions.get(assignment.id);
      const presentation = assignment.item ?? (assignment.periodKey.endsWith(':APPLICATION') ? version?.applicationQuestions[0] : version);
      return {
        id: assignment.id,
        kind: assignment.kind as AssessmentKind,
        periodKey: assignment.periodKey,
        sentenceId: assignment.cohort.sentenceId,
        prompt: presentation?.prompt ?? '',
        meaning: presentation?.meaning ?? '',
        opensAt: assignment.opensAt.toISOString(),
        dueAt: assignment.dueAt.toISOString(),
        closesAt: assignment.closesAt.toISOString(),
        started: Boolean(assignment.sessionItemId),
        answeredAt: assignment.answeredAt?.toISOString() ?? null,
        result: assignment.result as AssessmentResult | null,
        inWindow: assignment.inWindow,
        exposureGapHours: assignment.exposureGapHours,
        interveningReviews: assignment.interveningReviews,
        status: assignmentStatus(assignment, now),
      };
    });
    const timezone = await currentTimezone(tx, userId);
    return {
      generatedAt: now.toISOString(),
      localDate: localDate(now, timezone),
      canStartWeekly,
      cohorts: { total: cohorts.length, unstarted: cohorts.filter((cohort) => !cohort.startedAt).length },
      stats: statsFor(assignments, now),
      summary: summaryFor(assignments, now),
      available: dtoAssignments
        .filter((assignment) => !assignment.answeredAt && new Date(assignment.opensAt) <= now && assignment.prompt)
        .map((assignment) => ({ id: assignment.id, kind: assignment.kind, dueAt: assignment.dueAt, closesAt: assignment.closesAt })),
      recent: dtoAssignments
        .filter((assignment) => assignment.answeredAt || assignment.status === 'MISSED')
        .slice(-10)
        .reverse()
        .map((assignment) => ({ id: assignment.id, kind: assignment.kind, result: assignment.result, inWindow: assignment.inWindow, answeredAt: assignment.answeredAt })),
      copy: {
        denominator: '평가율은 사전에 배정된 문장을 분모로 계산하며, 미응시와 기간 밖 응시는 따로 표시합니다.',
        retention: '7일/30일 유지는 첫 입력 회상 시점 기준의 UTC 경과일 창으로 기록합니다.',
      },
      assignments: dtoAssignments,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function createAssessmentSession(userId: string, input: { kind: AssessmentSessionKind }, now = new Date()) {
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await backfillCohorts(tx, userId);
    const timezone = await currentTimezone(tx, userId);
    const studyDate = localDate(now, timezone);
    const plan = await tx.studyPlan.findUnique({ where: { userId } });
    if (!plan || plan.paused) throw new HttpError(409, '학습 계획을 설정하고 일시정지를 해제해 주세요.');
    if (input.kind === 'WEEKLY') await ensureWeeklyAssignments(tx, userId, now, timezone);

    const active = await activeAssessmentSessionForKind(tx, userId, input.kind, studyDate, timezone);
    if (active && active.items.length) return { id: active.id };

    const dueAssignments = await openAssignments(tx, userId, input.kind, now);
    if (!dueAssignments.length) throw new HttpError(409, '지금 응시할 평가 문항이 없습니다.');

    const versions = await presentationVersions(tx, userId, dueAssignments);
    const existingItems = await reusableActiveItems(tx, userId, studyDate, timezone, dueAssignments.map((assignment) => assignment.cohort.sentenceId));
    const selected = dueAssignments
      .map((assignment) => ({ assignment, version: versions.get(assignment.id) }))
      .filter((entry): entry is { assignment: typeof dueAssignments[number]; version: PublishedVersion } => Boolean(entry.version))
      .slice(0, ASSESSMENT_ITEM_LIMIT);
    if (!selected.length) throw new HttpError(409, '현재 발행 중인 선택 세트에서 평가 문항을 만들 수 없습니다.');

    const linkedAssignments: { assignmentId: string; itemId: string; sessionId: string }[] = [];
    let createItems: { entry: typeof selected[number]; form: AssessmentForm; application: PublishedVersion['applicationQuestions'][number] | null }[] = [];
    for (const entry of selected) {
      const form: AssessmentForm = entry.assignment.kind === 'WEEKLY' && entry.assignment.periodKey.endsWith(':APPLICATION') ? 'APPLICATION' : 'RECALL';
      const application = form === 'APPLICATION' ? entry.version.applicationQuestions[0] ?? null : null;
      if (form === 'APPLICATION' && !application) continue;
      const existingItem = existingItems.get(`${entry.assignment.cohort.sentenceId}:${form}:${entry.version.id}`);
      if (existingItem) {
        linkedAssignments.push({ assignmentId: entry.assignment.id, itemId: existingItem.id, sessionId: existingItem.sessionId });
        continue;
      }
      createItems.push({ entry, form, application });
    }
    if (!linkedAssignments.length && !createItems.length) throw new HttpError(409, '지금 응시할 평가 문항이 없습니다.');
    const budget = await assessmentBudget(tx, userId, now, timezone, studyDate);
    const duplicateAssignments: { assignmentId: string; key: string }[] = [];
    const seenItems = new Set<string>();
    createItems = createItems.filter((item) => {
      const key = `${item.entry.assignment.cohort.sentenceId}:${item.form}:${item.entry.version.id}`;
      if (seenItems.has(key)) { duplicateAssignments.push({ assignmentId: item.entry.assignment.id, key }); return false; }
      seenItems.add(key);
      return true;
    });
    if (createItems.length) {
      let remainingSeconds = budget.remainingSeconds;
      const budgetedItems: typeof createItems = [];
      for (const item of createItems) {
        const seconds = item.form === 'APPLICATION' ? 60 : 30;
        if (seconds > remainingSeconds) continue;
        budgetedItems.push(item);
        remainingSeconds -= seconds;
      }
      createItems = budgetedItems;
    }
    if (!createItems.length) {
      if (!linkedAssignments.length) throw new HttpError(409, budget.exhaustedMessage ?? '지금 응시할 평가 문항이 없습니다.');
      for (const link of linkedAssignments) {
        await tx.assessmentAssignment.update({
          where: { id: link.assignmentId },
          data: { sessionItemId: link.itemId },
        });
      }
      return { id: linkedAssignments[0]!.sessionId };
    }

    const session = await tx.studySession.create({
      data: {
        userId,
        purpose: 'ASSESSMENT',
        mode: 'WRITTEN',
        studyDate,
        timezone,
        createdAt: now,
        items: {
          create: createItems.map(({ entry, form, application }, index) => ({
            sentenceVersionId: entry.version.id,
            sentenceId: entry.assignment.cohort.sentenceId,
            prompt: application?.prompt ?? entry.version.prompt,
            meaning: application?.meaning ?? entry.version.meaning,
            position: index + 1,
            scheduledAt: now,
            estimatedSeconds: form === 'APPLICATION' ? 60 : 30,
            form,
            applicationQuestionId: application?.id,
          })),
        },
      },
      include: { items: { orderBy: { position: 'asc' } } },
    });

    const createdBySentenceAndForm = new Map(session.items.map((item) => [`${item.sentenceId}:${item.form}:${item.sentenceVersionId}`, item.id]));
    for (const link of linkedAssignments) {
      await tx.assessmentAssignment.update({
        where: { id: link.assignmentId },
        data: { sessionItemId: link.itemId },
      });
    }
    for (const { entry, form } of createItems) {
      await tx.assessmentAssignment.update({
        where: { id: entry.assignment.id },
        data: { sessionItemId: createdBySentenceAndForm.get(`${entry.assignment.cohort.sentenceId}:${form}:${entry.version.id}`) },
      });
    }
    for (const duplicate of duplicateAssignments) {
      const itemId = createdBySentenceAndForm.get(duplicate.key);
      if (itemId) await tx.assessmentAssignment.update({ where: { id: duplicate.assignmentId }, data: { sessionItemId: itemId } });
    }
    return { id: session.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 });
}

async function ensureCohortStarted(
  tx: Database,
  userId: string,
  sentenceId: string,
  versionId: string,
  form: AssessmentForm,
  performedAt: Date,
) {
  const existing = await tx.assessmentCohort.findUnique({ where: { userId_sentenceId: { userId, sentenceId } } });
  if (existing && existing.selectedAt > performedAt) {
    await tx.assessmentCohort.update({ where: { id: existing.id }, data: { selectedAt: performedAt } });
  }
  const shouldStart = form === 'RECALL';
  const cohort = existing
    ? await tx.assessmentCohort.update({
      where: { id: existing.id },
      data: shouldStart && !existing.startedAt ? { startedAt: performedAt, baselineVersionId: versionId } : {},
    })
    : await tx.assessmentCohort.create({
      data: {
        userId,
        sentenceId,
        selectedAt: performedAt,
        startedAt: shouldStart ? performedAt : null,
        baselineVersionId: shouldStart ? versionId : null,
      },
    });
  if (shouldStart && !existing?.startedAt) await ensureRetentionAssignments(tx, cohort.id, performedAt);
  return cohort;
}

async function ensureRetentionAssignments(tx: Database, cohortId: string, startedAt: Date) {
  await tx.assessmentAssignment.createMany({
    data: retentionWindows(startedAt).map((window) => ({ cohortId, ...window })),
    skipDuplicates: true,
  });
}

async function backfillCohorts(tx: Database, userId: string) {
  const enrolled = await tx.enrollment.findMany({
    where: { userId }, orderBy: { createdAt: 'asc' },
    include: { set: { include: { sentences: { include: { sentenceVersion: { select: { sentenceId: true } } } } } } },
  });
  for (const enrollment of enrolled) {
    await registerCohort(tx, userId, enrollment.set.sentences.map((item) => item.sentenceVersion.sentenceId), enrollment.createdAt);
  }
  const rows = await tx.reviewEvent.findMany({
    where: { userId, item: { session: { mode: 'WRITTEN' }, form: 'RECALL' } },
    orderBy: { performedAt: 'asc' },
    include: { item: true },
  });
  const seen = new Set<string>();
  for (const event of rows) {
    if (seen.has(event.item.sentenceId)) continue;
    seen.add(event.item.sentenceId);
    const existing = await tx.assessmentCohort.findUnique({ where: { userId_sentenceId: { userId, sentenceId: event.item.sentenceId } } });
    const cohort = existing
      ? await tx.assessmentCohort.update({
        where: { id: existing.id },
        data: {
          selectedAt: existing.selectedAt > event.performedAt ? event.performedAt : existing.selectedAt,
          startedAt: existing.startedAt ?? event.performedAt,
          baselineVersionId: existing.baselineVersionId ?? event.item.sentenceVersionId,
        },
      })
      : await tx.assessmentCohort.create({
        data: {
          userId,
          sentenceId: event.item.sentenceId,
          selectedAt: event.performedAt,
          startedAt: event.performedAt,
          baselineVersionId: event.item.sentenceVersionId,
        },
      });
    await ensureRetentionAssignments(tx, cohort.id, cohort.startedAt ?? event.performedAt);
  }
}

async function ensureWeeklyAssignments(tx: Database, userId: string, now: Date, timezone: string) {
  const window = weeklyWindow(now, timezone);
  if (await tx.assessmentAssignment.count({ where: { cohort: { userId }, kind: 'WEEKLY', periodKey: { in: [window.periodKey, `${window.periodKey}:APPLICATION`] } } })) return;
  const versions = [...(await currentPublishedVersions(tx, userId)).values()];
  const practicedIds = new Set((await tx.reviewEvent.findMany({
    where: { userId, item: { session: { mode: 'WRITTEN' }, form: 'RECALL' } },
    select: { item: { select: { sentenceId: true } } },
  })).map((event) => event.item.sentenceId));
  const studied = versions.filter((version) => practicedIds.has(version.sentenceId));
  await registerCohort(tx, userId, studied.map((version) => version.sentenceId), now);
  const recall = deterministicSample(studied, WEEKLY_RECALL_LIMIT, (version) => `${userId}:${window.periodKey}:RECALL:${version.sentenceId}`);
  const application = deterministicSample(
    studied.filter((version) => version.applicationQuestions.length),
    WEEKLY_APPLICATION_LIMIT,
    (version) => `${userId}:${window.periodKey}:APPLICATION:${version.sentenceId}`,
  );
  const cohorts = await tx.assessmentCohort.findMany({ where: { userId, sentenceId: { in: [...recall, ...application].map((version) => version.sentenceId) } } });
  const cohortBySentence = new Map(cohorts.map((cohort) => [cohort.sentenceId, cohort.id]));
  await tx.assessmentAssignment.createMany({
    data: [
      ...recall.map((version) => ({ cohortId: cohortBySentence.get(version.sentenceId)!, ...window })),
      ...application.map((version) => ({ cohortId: cohortBySentence.get(version.sentenceId)!, ...window, periodKey: `${window.periodKey}:APPLICATION` })),
    ],
    skipDuplicates: true,
  });
}

type PublishedVersion = {
  id: string;
  sentenceId: string;
  prompt: string;
  meaning: string;
  applicationQuestions: { id: string; prompt: string; meaning: string }[];
};

async function presentationVersions(tx: Database, userId: string, assignments: AssessmentAssignmentWithCohort[]) {
  const eligible = await currentPublishedVersions(tx, userId, assignments.map((assignment) => assignment.cohort.sentenceId));
  const retentionBaselineIds = assignments
    .filter((assignment) => assignment.kind !== 'WEEKLY' && assignment.cohort.baselineVersionId && eligible.has(assignment.cohort.sentenceId))
    .map((assignment) => assignment.cohort.baselineVersionId!);
  const baselines = await versionsById(tx, retentionBaselineIds);
  const versions = new Map<string, PublishedVersion>();
  for (const assignment of assignments) {
    const current = eligible.get(assignment.cohort.sentenceId);
    if (!current) continue;
    const baseline = assignment.kind !== 'WEEKLY' && assignment.cohort.baselineVersionId
      ? baselines.get(assignment.cohort.baselineVersionId)
      : null;
    versions.set(assignment.id, baseline?.sentenceId === assignment.cohort.sentenceId ? baseline : current);
  }
  return versions;
}

async function versionsById(tx: Database, ids: string[]) {
  if (!ids.length) return new Map<string, PublishedVersion>();
  const versions = await tx.sentenceVersion.findMany({
    where: { id: { in: [...new Set(ids)] } },
    include: { applicationQuestions: { where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'asc' } } },
  });
  return new Map(versions.map((version) => [version.id, {
    id: version.id,
    sentenceId: version.sentenceId,
    prompt: version.prompt,
    meaning: version.meaning,
    applicationQuestions: version.applicationQuestions.map((question) => ({ id: question.id, prompt: question.prompt, meaning: question.meaning })),
  }]));
}

async function currentPublishedVersions(tx: Database, userId: string, sentenceIds?: string[]): Promise<Map<string, PublishedVersion>> {
  const enrollments = await tx.enrollment.findMany({
      where: { userId, paused: false, set: { status: 'PUBLISHED' } },
      orderBy: [{ createdAt: 'asc' }, { setId: 'asc' }],
      include: {
        set: {
          include: {
            sentences: {
              orderBy: { order: 'asc' },
              include: {
                sentenceVersion: {
                  include: { applicationQuestions: { where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'asc' } } },
                },
              },
            },
          },
        },
      },
    });
  const hiddenPreferences = await tx.userSentencePreference.findMany({ where: { userId, hidden: true }, select: { sentenceId: true } });
  const hidden = new Set(hiddenPreferences.map((preference) => preference.sentenceId));
  const allowed = sentenceIds ? new Set(sentenceIds) : null;
  const versions = new Map<string, PublishedVersion>();
  for (const enrollment of enrollments) {
    for (const item of enrollment.set.sentences) {
      const version = item.sentenceVersion;
      if (hidden.has(version.sentenceId)) continue;
      if (allowed && !allowed.has(version.sentenceId)) continue;
      if (!versions.has(version.sentenceId)) {
        versions.set(version.sentenceId, {
          id: version.id,
          sentenceId: version.sentenceId,
          prompt: version.prompt,
          meaning: version.meaning,
          applicationQuestions: version.applicationQuestions.map((question) => ({ id: question.id, prompt: question.prompt, meaning: question.meaning })),
        });
      }
    }
  }
  return versions;
}

async function canCreateWeeklyAssessment(tx: Database, userId: string) {
  const versions = await currentPublishedVersions(tx, userId);
  if (!versions.size) return false;
  const reviewed = await tx.reviewEvent.findFirst({
    where: {
      userId,
      item: { sentenceId: { in: [...versions.keys()] }, session: { mode: 'WRITTEN' }, form: 'RECALL' },
    },
    select: { id: true },
  });
  return Boolean(reviewed);
}

async function openAssignments(tx: Database, userId: string, kind: AssessmentSessionKind, now: Date) {
  return tx.assessmentAssignment.findMany({
    where: {
      answeredAt: null,
      opensAt: { lte: now },
      kind: kind === 'WEEKLY' ? 'WEEKLY' : { in: ['RETENTION_7', 'RETENTION_30'] },
      cohort: { userId },
    },
    orderBy: [{ dueAt: 'asc' }, { opensAt: 'asc' }],
    include: { cohort: true },
  });
}

async function reusableActiveItems(tx: Database, userId: string, studyDate: string, timezone: string, sentenceIds: string[]) {
  const items = await tx.sessionItem.findMany({
    where: {
      sentenceId: { in: sentenceIds },
      reviewEvent: null,
      session: { userId, status: 'ACTIVE', mode: 'WRITTEN', studyDate, timezone, purpose: { in: ['DAILY', 'ASSESSMENT'] } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return new Map(items.map((item) => [`${item.sentenceId}:${item.form}:${item.sentenceVersionId}`, item]));
}

async function activeAssessmentSessionForKind(tx: Database, userId: string, kind: AssessmentSessionKind, studyDate: string, timezone: string) {
  const sessions = await tx.studySession.findMany({
    where: { userId, purpose: 'ASSESSMENT', mode: 'WRITTEN', status: 'ACTIVE', studyDate, timezone },
    orderBy: { createdAt: 'asc' },
    include: { items: { where: { reviewEvent: null }, include: { assessments: true } } },
  });
  return sessions.find((session) => session.items.some((item) => item.assessments.some((assignment) => (
    kind === 'WEEKLY' ? assignment.kind === 'WEEKLY' : assignment.kind === 'RETENTION_7' || assignment.kind === 'RETENTION_30'
  )))) ?? null;
}

async function assessmentBudget(tx: Database, userId: string, now: Date, timezone: string, studyDate: string) {
  const storedPlan = await tx.studyPlan.findUnique({ where: { userId }, include: { exceptions: true } });
  if (!storedPlan) throw new HttpError(409, '먼저 학습 계획을 설정해 주세요.');
  const plan = completeStudyPlanSchema.parse(storedPlan);
  if (plan.paused) return { remainingSeconds: 0, exhaustedMessage: '학습이 일시정지되어 평가 세션을 만들 수 없습니다.' };
  if (plan.timezone !== timezone || studyDate !== localDate(now, plan.timezone)) {
    return { remainingSeconds: 0, exhaustedMessage: '현재 학습일과 평가 학습일이 일치하지 않습니다.' };
  }
  const start = dateStart(studyDate, plan.timezone);
  const end = dateStart(addCalendarDays(studyDate, 1), plan.timezone);
  const slot = nextStudyAt(start, { ...plan, paused: false });
  if (!isStudyDate(studyDate, plan) || !slot || slot > now) {
    return { remainingSeconds: 0, exhaustedMessage: '오늘은 아직 평가 세션을 만들 수 있는 학습 시간이 아닙니다.' };
  }
  const [dayEvents, pendingSessions, lastEvent] = await Promise.all([
    tx.reviewEvent.findMany({ where: { userId, performedAt: { gte: start, lt: end } }, include: { item: true } }),
    tx.studySession.findMany({
      where: { userId, purpose: { in: ['DAILY', 'ASSESSMENT'] }, status: 'ACTIVE', studyDate, timezone: plan.timezone },
      include: { items: { where: { reviewEvent: null } } },
    }),
    tx.reviewEvent.findFirst({ where: { userId }, orderBy: { performedAt: 'desc' }, select: { performedAt: true } }),
  ]);
  const recovery = storedPlan.recoveryDate === studyDate || Boolean(lastEvent && now.getTime() - lastEvent.performedAt.getTime() >= 7 * 24 * 60 * 60 * 1000);
  const effectiveMinutes = recovery ? Math.min(plan.dailyMinutes, 3) : plan.dailyMinutes;
  const spentSeconds = dayEvents.reduce((sum, event) => sum + event.item.estimatedSeconds, 0);
  const reservedSeconds = pendingSessions.flatMap((session) => session.items).reduce((sum, item) => sum + item.estimatedSeconds, 0);
  const remainingSeconds = Math.max(0, effectiveMinutes * 60 - spentSeconds - reservedSeconds);
  return { remainingSeconds, exhaustedMessage: remainingSeconds > 0 ? null : '오늘 평가에 사용할 학습 시간이 남아 있지 않습니다.' };
}

function assignmentStatus(
  assignment: { answeredAt: Date | null; sessionItemId: string | null; opensAt: Date; closesAt: Date },
  now: Date,
): AssessmentDTO['assignments'][number]['status'] {
  if (assignment.answeredAt) return 'ANSWERED';
  if (assignment.closesAt < now) return 'MISSED';
  if (assignment.opensAt > now) return 'UPCOMING';
  if (assignment.sessionItemId) return 'OPEN';
  return 'NOT_STARTED';
}

function statsFor(assignments: { sessionItemId: string | null; answeredAt: Date | null; result: string | null; inWindow: boolean | null; closesAt: Date }[], now: Date): AssessmentStats {
  const assigned = assignments.length;
  const started = assignments.filter((assignment) => assignment.sessionItemId).length;
  const answered = assignments.filter((assignment) => assignment.answeredAt).length;
  const inWindowCorrect = assignments.filter((assignment) => assignment.result === 'CORRECT' && assignment.inWindow).length;
  const incorrect = assignments.filter((assignment) => assignment.result === 'INCORRECT' && assignment.inWindow).length;
  const missed = assignments.filter((assignment) => !assignment.answeredAt && assignment.closesAt < now).length;
  const outside = assignments.filter((assignment) => assignment.answeredAt && assignment.inWindow === false).length;
  return {
    assigned,
    started,
    notStarted: assigned - started,
    answered,
    inWindowCorrect,
    incorrect,
    missed,
    outside,
    pct: {
      numerator: inWindowCorrect,
      denominator: assigned,
      value: assigned ? inWindowCorrect / assigned : null,
    },
  };
}

function summaryFor(assignments: { kind: string; answeredAt: Date | null; result: string | null; inWindow: boolean | null; closesAt: Date }[], now: Date) {
  return {
    retention7: summaryBucket(assignments.filter((assignment) => assignment.kind === 'RETENTION_7'), now),
    retention30: summaryBucket(assignments.filter((assignment) => assignment.kind === 'RETENTION_30'), now),
    weekly: summaryBucket(assignments.filter((assignment) => assignment.kind === 'WEEKLY'), now),
  };
}

function summaryBucket(assignments: { answeredAt: Date | null; result: string | null; inWindow: boolean | null; closesAt: Date }[], now: Date): AssessmentSummary {
  const assigned = assignments.length;
  const attempted = assignments.filter((assignment) => assignment.answeredAt).length;
  const correct = assignments.filter((assignment) => assignment.result === 'CORRECT' && assignment.inWindow).length;
  const missed = assignments.filter((assignment) => !assignment.answeredAt && assignment.closesAt < now).length;
  const outsideWindow = assignments.filter((assignment) => assignment.answeredAt && assignment.inWindow === false).length;
  return {
    assigned,
    attempted,
    correct,
    missed,
    outsideWindow,
    notStarted: Math.max(0, assigned - attempted - missed),
    rate: assigned ? Math.round((correct / assigned) * 100) : null,
  };
}

async function currentTimezone(tx: Database, userId: string) {
  const plan = await tx.studyPlan.findUnique({ where: { userId }, select: { timezone: true } });
  return plan?.timezone ?? 'Asia/Seoul';
}

async function lockUser(tx: Database, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM app."AppUser" WHERE id=${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(401, '로그인이 필요합니다.');
}
