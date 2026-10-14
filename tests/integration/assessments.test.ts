import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({ path: '.env.local', quiet: true });

type Db = typeof import('@/server/db')['db'];
type AssessmentServices = typeof import('@/server/services/assessments');
type LearningServices = typeof import('@/server/services/learning');

let db: Db;
let assessments: AssessmentServices;
let learning: LearningServices;

const runId = randomUUID();
const emailDomain = `${runId}.assessments.test`;
const createdUserIds = new Set<string>();
const createdSetIds = new Set<string>();
const createdSentenceIds = new Set<string>();

describe('M5 assessments integration', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required. Run pnpm local:setup before integration tests.');
    const hostname = new URL(databaseUrl).hostname;
    if (!['127.0.0.1', 'localhost'].includes(hostname)) {
      throw new Error(`Refusing to run integration tests against non-local database host: ${hostname}`);
    }

    ({ db } = await import('@/server/db'));
    assessments = await import('@/server/services/assessments');
    learning = await import('@/server/services/learning');
    await db.$queryRaw`select 1`;
  });

  afterAll(async () => {
    if (!db) return;
    await db.appUser.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    await db.setSentence.deleteMany({ where: { setId: { in: [...createdSetIds] } } });
    await db.studySet.deleteMany({ where: { id: { in: [...createdSetIds] } } });
    await db.sentenceVersion.deleteMany({ where: { sentenceId: { in: [...createdSentenceIds] } } });
    await db.sentence.deleteMany({ where: { id: { in: [...createdSentenceIds] } } });
    await db.$disconnect();
  });

  it('creates retention assignments when the first recall answer starts a cohort', async () => {
    const now = new Date('2026-10-14T09:00:00.000Z');
    const user = await createUser('retention-start');
    const { sentence, version } = await createPublishedSet(user.id, 'retention-start');

    await db.$transaction((tx) => assessments.recordAssessmentAnswer(tx, {
      userId: user.id,
      itemId: 'item-not-linked',
      sentenceId: sentence.id,
      versionId: version.id,
      eventId: randomUUID(),
      result: 'INCORRECT',
      mode: 'WRITTEN',
      form: 'RECALL',
      performedAt: now,
      previousExposureAt: null,
    }));

    const dto = await assessments.getAssessments(user.id, now);

    expect(dto.assignments.map((assignment) => assignment.kind)).toEqual(['RETENTION_7', 'RETENTION_30']);
    expect(dto.stats).toMatchObject({ assigned: 2, answered: 0, notStarted: 2 });
  });

  it('marks linked retention assignments outside the window when answered late', async () => {
    const startedAt = new Date('2026-10-01T09:00:00.000Z');
    const late = new Date('2026-10-25T09:00:00.000Z');
    const user = await createUser('retention-late');
    const { sentence, version } = await createPublishedSet(user.id, 'retention-late');
    const item = await createSessionItem(user.id, sentence.id, version.id, startedAt);

    await db.$transaction(async (tx) => {
      await assessments.recordAssessmentAnswer(tx, {
        userId: user.id,
        itemId: item.id,
        sentenceId: sentence.id,
        versionId: version.id,
        eventId: randomUUID(),
        result: 'CORRECT',
        mode: 'WRITTEN',
        form: 'RECALL',
        performedAt: startedAt,
        previousExposureAt: null,
      });
      const assignment = await tx.assessmentAssignment.findFirstOrThrow({
        where: { cohort: { userId: user.id, sentenceId: sentence.id }, kind: 'RETENTION_7' },
      });
      await tx.assessmentAssignment.update({ where: { id: assignment.id }, data: { sessionItemId: item.id } });
      await assessments.recordAssessmentAnswer(tx, {
        userId: user.id,
        itemId: item.id,
        sentenceId: sentence.id,
        versionId: version.id,
        eventId: randomUUID(),
        result: 'CORRECT',
        mode: 'WRITTEN',
        form: 'RECALL',
        performedAt: late,
        previousExposureAt: new Date('2026-10-20T09:00:00.000Z'),
      });
    });

    const dto = await assessments.getAssessments(user.id, late);
    const retention = dto.assignments.find((assignment) => assignment.kind === 'RETENTION_7');

    expect(retention).toMatchObject({ result: 'CORRECT', inWindow: false, exposureGapHours: 120 });
    expect(dto.stats).toMatchObject({ answered: 1, outside: 1, inWindowCorrect: 0 });
  });

  it('creates a weekly assessment session with recall and application items from active published content', async () => {
    const now = new Date('2026-10-14T09:00:00.000Z');
    const user = await createUser('weekly-session');
    for (let index = 0; index < 7; index += 1) {
      const slug = `weekly-session-${index}`;
      await createPublishedSet(user.id, slug, { withApplication: true });
      await seedWrittenReview(user.id, slug, now);
    }

    const session = await assessments.createAssessmentSession(user.id, { kind: 'WEEKLY' }, now);
    const stored = await db.studySession.findUniqueOrThrow({ where: { id: session.id }, include: { items: { orderBy: { position: 'asc' } } } });

    expect(stored).toMatchObject({ purpose: 'ASSESSMENT', mode: 'WRITTEN', studyDate: '2026-10-14', timezone: 'Asia/Seoul' });
    expect(stored.items.length).toBeGreaterThan(0);
    expect(stored.items.some((item) => item.form === 'APPLICATION')).toBe(true);
    await expect(assessments.createAssessmentSession(user.id, { kind: 'WEEKLY' }, now)).resolves.toEqual({ id: session.id });
  });

  it('links an open retention assignment to an existing same-day written recall item', async () => {
    const now = new Date('2026-10-14T09:00:00.000Z');
    const user = await createUser('reuse-daily-item');
    const { sentence, version } = await createPublishedSet(user.id, 'reuse-daily-item');
    const dailyItem = await createSessionItem(user.id, sentence.id, version.id, now, 'DAILY');
    const cohort = await db.assessmentCohort.create({
      data: { userId: user.id, sentenceId: sentence.id, selectedAt: now, startedAt: now, baselineVersionId: version.id },
    });
    const assignment = await db.assessmentAssignment.create({
      data: {
        cohortId: cohort.id,
        kind: 'RETENTION_7',
        periodKey: 'RETENTION_7:reuse-daily-item',
        opensAt: new Date(now.getTime() - 60_000),
        dueAt: now,
        closesAt: new Date(now.getTime() + 60_000),
      },
    });

    const session = await assessments.createAssessmentSession(user.id, { kind: 'RETENTION' }, now);
    const linked = await db.assessmentAssignment.findUniqueOrThrow({ where: { id: assignment.id } });

    expect(session.id).toBe(dailyItem.sessionId);
    expect(linked.sessionItemId).toBe(dailyItem.id);
  });

  it('keeps overdue retention assignments available for late attempts', async () => {
    const now = new Date('2026-10-14T09:00:00.000Z');
    const user = await createUser('overdue-retention');
    const { sentence, version } = await createPublishedSet(user.id, 'overdue-retention');
    const cohort = await db.assessmentCohort.create({
      data: { userId: user.id, sentenceId: sentence.id, selectedAt: now, startedAt: now, baselineVersionId: version.id },
    });
    const assignment = await db.assessmentAssignment.create({
      data: {
        cohortId: cohort.id,
        kind: 'RETENTION_7',
        periodKey: 'RETENTION_7:overdue-retention',
        opensAt: new Date('2026-10-01T09:00:00.000Z'),
        dueAt: new Date('2026-10-03T09:00:00.000Z'),
        closesAt: new Date('2026-10-05T09:00:00.000Z'),
      },
    });

    const dto = await assessments.getAssessments(user.id, now);
    const session = await assessments.createAssessmentSession(user.id, { kind: 'RETENTION' }, now);
    const linked = await db.assessmentAssignment.findUniqueOrThrow({ where: { id: assignment.id } });

    expect(dto.available).toContainEqual(expect.objectContaining({ id: assignment.id, kind: 'RETENTION_7' }));
    expect(dto.assignments.find((item) => item.id === assignment.id)).toMatchObject({ status: 'MISSED' });
    expect(linked.sessionItemId).toBeTruthy();
    expect(session.id).toBeTruthy();
  });

  it('uses the cohort baseline version for retention display and session items while requiring active published eligibility', async () => {
    const now = new Date('2026-10-14T09:00:00.000Z');
    const user = await createUser('baseline-retention');
    const { sentence, version, set } = await createPublishedSet(user.id, 'baseline-retention-v1');
    const replacement = await createReplacementSet(user.id, sentence.id, 'baseline-retention-v2');
    await db.studySet.update({ where: { id: set.id }, data: { status: 'ARCHIVED' } });
    const cohort = await db.assessmentCohort.create({
      data: { userId: user.id, sentenceId: sentence.id, selectedAt: now, startedAt: now, baselineVersionId: version.id },
    });
    await db.assessmentAssignment.create({
      data: {
        cohortId: cohort.id,
        kind: 'RETENTION_7',
        periodKey: 'RETENTION_7:baseline-retention',
        opensAt: new Date(now.getTime() - 60_000),
        dueAt: now,
        closesAt: new Date(now.getTime() + 60_000),
      },
    });

    const dto = await assessments.getAssessments(user.id, now);
    const session = await assessments.createAssessmentSession(user.id, { kind: 'RETENTION' }, now);
    const item = await db.sessionItem.findFirstOrThrow({ where: { sessionId: session.id } });

    expect(replacement.version.prompt).toBe('Prompt baseline-retention-v2');
    expect(dto.assignments[0]).toMatchObject({ prompt: 'Prompt baseline-retention-v1', meaning: 'Meaning baseline-retention-v1' });
    expect(item).toMatchObject({ sentenceVersionId: version.id, prompt: 'Prompt baseline-retention-v1', meaning: 'Meaning baseline-retention-v1' });
  });

  it('reuses only same-version DAILY or ASSESSMENT items and never PRACTICE items', async () => {
    const now = new Date('2026-10-14T09:00:00.000Z');
    const user = await createUser('reuse-version-purpose');
    const { sentence, version } = await createPublishedSet(user.id, 'reuse-version-purpose-v1');
    const replacement = await createReplacementSet(user.id, sentence.id, 'reuse-version-purpose-v2');
    const practiceItem = await createSessionItem(user.id, sentence.id, version.id, now, 'PRACTICE');
    const wrongVersionDailyItem = await createSessionItem(user.id, sentence.id, replacement.version.id, now, 'DAILY');
    const cohort = await db.assessmentCohort.create({
      data: { userId: user.id, sentenceId: sentence.id, selectedAt: now, startedAt: now, baselineVersionId: version.id },
    });
    const assignment = await db.assessmentAssignment.create({
      data: {
        cohortId: cohort.id,
        kind: 'RETENTION_7',
        periodKey: 'RETENTION_7:reuse-version-purpose',
        opensAt: new Date(now.getTime() - 60_000),
        dueAt: now,
        closesAt: new Date(now.getTime() + 60_000),
      },
    });

    const session = await assessments.createAssessmentSession(user.id, { kind: 'RETENTION' }, now);
    const linked = await db.assessmentAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    const linkedItem = await db.sessionItem.findUniqueOrThrow({ where: { id: linked.sessionItemId! }, include: { session: true } });

    expect(linked.sessionItemId).not.toBe(practiceItem.id);
    expect(linked.sessionItemId).not.toBe(wrongVersionDailyItem.id);
    expect(session.id).toBe(linkedItem.sessionId);
    expect(linkedItem).toMatchObject({ sentenceVersionId: version.id });
    expect(linkedItem.session).toMatchObject({ purpose: 'ASSESSMENT' });
  });

  it('does not reuse an active assessment session from the other assessment kind', async () => {
    const now = new Date('2026-10-14T09:00:00.000Z');
    const user = await createUser('active-kind-scope');
    const weekly = await createPublishedSet(user.id, 'active-kind-scope-weekly');
    const retention = await createPublishedSet(user.id, 'active-kind-scope-retention');
    const weeklySession = await createSessionItem(user.id, weekly.sentence.id, weekly.version.id, now, 'ASSESSMENT');
    const weeklyCohort = await db.assessmentCohort.create({
      data: { userId: user.id, sentenceId: weekly.sentence.id, selectedAt: now },
    });
    await db.assessmentAssignment.create({
      data: {
        cohortId: weeklyCohort.id,
        kind: 'WEEKLY',
        periodKey: 'week:2026-10-13',
        opensAt: new Date(now.getTime() - 60_000),
        dueAt: now,
        closesAt: new Date(now.getTime() + 60_000),
        sessionItemId: weeklySession.id,
      },
    });
    const retentionCohort = await db.assessmentCohort.create({
      data: { userId: user.id, sentenceId: retention.sentence.id, selectedAt: now, startedAt: now, baselineVersionId: retention.version.id },
    });
    await db.assessmentAssignment.create({
      data: {
        cohortId: retentionCohort.id,
        kind: 'RETENTION_7',
        periodKey: 'RETENTION_7:active-kind-scope',
        opensAt: new Date(now.getTime() - 60_000),
        dueAt: now,
        closesAt: new Date(now.getTime() + 60_000),
      },
    });

    const session = await assessments.createAssessmentSession(user.id, { kind: 'RETENTION' }, now);

    expect(session.id).not.toBe(weeklySession.sessionId);
  });

  it('rejects new assessment items when the daily workload budget is exhausted', async () => {
    const now = new Date('2026-10-14T09:00:00.000Z');
    const user = await createUser('assessment-budget', { dailyMinutes: 3 });
    const pending = [];
    for (let index = 0; index < 6; index += 1) {
      pending.push(await createPublishedSet(user.id, `assessment-budget-pending-${index}`));
    }
    await createPendingDailySession(user.id, pending.map((entry) => ({ sentenceId: entry.sentence.id, versionId: entry.version.id })), now);
    const { sentence, version } = await createPublishedSet(user.id, 'assessment-budget-target');
    const cohort = await db.assessmentCohort.create({
      data: { userId: user.id, sentenceId: sentence.id, selectedAt: now, startedAt: now, baselineVersionId: version.id },
    });
    await db.assessmentAssignment.create({
      data: {
        cohortId: cohort.id,
        kind: 'RETENTION_7',
        periodKey: 'RETENTION_7:assessment-budget-target',
        opensAt: new Date(now.getTime() - 60_000),
        dueAt: now,
        closesAt: new Date(now.getTime() + 60_000),
      },
    });

    await expect(assessments.createAssessmentSession(user.id, { kind: 'RETENTION' }, now)).rejects.toMatchObject({ status: 409 });
  });


  it('keeps the weekly denominator fixed after more sentences are studied and supports small cohorts with application', async () => {
    const now = new Date('2026-10-14T09:00:00Z');
    const user = await createUser('weekly-fixed');
    await createPublishedSet(user.id, 'weekly-fixed-first', { withApplication: true });
    await seedWrittenReview(user.id, 'weekly-fixed-first', now);
    const session = await assessments.createAssessmentSession(user.id, { kind: 'WEEKLY' }, now);
    const initial = await db.assessmentAssignment.findMany({ where: { cohort: { userId: user.id }, kind: 'WEEKLY' } });
    expect(initial).toHaveLength(2);
    await createPublishedSet(user.id, 'weekly-fixed-second', { withApplication: true });
    await seedWrittenReview(user.id, 'weekly-fixed-second', now);
    await assessments.createAssessmentSession(user.id, { kind: 'WEEKLY' }, now);
    expect(await db.assessmentAssignment.count({ where: { cohort: { userId: user.id }, kind: 'WEEKLY' } })).toBe(initial.length);
    expect(await db.sessionItem.count({ where: { sessionId: session.id } })).toBe(2);
  });

  it('links overlapping overdue retention windows to one item and one review event', async () => {
    const now = new Date('2026-10-14T09:00:00Z');
    const user = await createUser('overlap-retention');
    const { sentence, version } = await createPublishedSet(user.id, 'overlap-retention');
    const cohort = await db.assessmentCohort.create({ data: { userId: user.id, sentenceId: sentence.id, startedAt: new Date('2026-09-14T09:00:00Z'), baselineVersionId: version.id } });
    for (const kind of ['RETENTION_7', 'RETENTION_30']) await db.assessmentAssignment.create({ data: { cohortId: cohort.id, kind, periodKey: kind, opensAt: new Date('2026-10-01T09:00:00Z'), dueAt: now, closesAt: now } });
    const session = await assessments.createAssessmentSession(user.id, { kind: 'RETENTION' }, now);
    const items = await db.sessionItem.findMany({ where: { sessionId: session.id } });
    expect(items).toHaveLength(1);
    await learning.answerSessionItem(user.id, session.id, { itemId: items[0]!.id, eventId: randomUUID(), answer: version.target }, now);
    expect(await db.assessmentAssignment.count({ where: { cohortId: cohort.id, result: 'CORRECT' } })).toBe(2);
    expect(await db.reviewEvent.count({ where: { userId: user.id } })).toBe(1);
  });

  it('backfills selected but never-attempted legacy enrollment sentences into the cohort denominator', async () => {
    const user = await createUser('legacy-unstarted');
    await createPublishedSet(user.id, 'legacy-unstarted');
    expect((await assessments.getAssessments(user.id)).cohorts).toEqual({ total: 1, unstarted: 1 });
  });

  it('grades an application assessment with its own answers without mutating sentence review state', async () => {
    const now = new Date('2026-10-14T09:00:00.000Z');
    const user = await createUser('application-answer');
    for (let index = 0; index < 7; index += 1) {
      const slug = `application-answer-${index}`;
      await createPublishedSet(user.id, slug, { withApplication: true });
      await seedWrittenReview(user.id, slug, now);
    }
    const session = await assessments.createAssessmentSession(user.id, { kind: 'WEEKLY' }, now);
    const item = await db.sessionItem.findFirstOrThrow({
      where: { sessionId: session.id, form: 'APPLICATION' },
      include: { applicationQuestion: true },
    });
    const eventId = randomUUID();

    const first = await learning.answerSessionItem(user.id, session.id, {
      itemId: item.id,
      eventId,
      answer: item.applicationQuestion!.target,
    }, now);
    const replay = await learning.answerSessionItem(user.id, session.id, {
      itemId: item.id,
      eventId,
      answer: item.applicationQuestion!.target,
    }, new Date(now.getTime() + 60_000));
    const state = await db.userSentenceState.findUnique({
      where: { userId_sentenceId_mode: { userId: user.id, sentenceId: item.sentenceId, mode: 'WRITTEN' } },
    });
    const review = await db.reviewEvent.findUniqueOrThrow({ where: { sessionItemId: item.id } });
    const assignment = await db.assessmentAssignment.findFirstOrThrow({ where: { sessionItemId: item.id } });

    expect(first).toMatchObject({ result: 'CORRECT', correct: true, form: 'APPLICATION', qualified: false, completed: false });
    expect(replay).toEqual(first);
    expect(state).toBeNull();
    expect(review).toMatchObject({ form: 'APPLICATION', qualified: false, reviewStep: null, nextDueAt: null });
    expect(assignment).toMatchObject({ result: 'CORRECT', inWindow: true });
  });
});

async function createUser(slug: string, options: { dailyMinutes?: 3 | 5 | 10 | 15 | 20 } = {}) {
  const user = await db.appUser.create({
    data: {
      id: randomUUID(),
      email: `${slug}-${emailDomain}`,
      displayName: `Assessment ${slug}`,
      onboarded: true,
    },
  });
  createdUserIds.add(user.id);
  await db.studyPlan.create({
    data: {
      userId: user.id,
      displayName: user.displayName!,
      dailyMinutes: options.dailyMinutes ?? 20,
      timezone: 'Asia/Seoul',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      anchorDate: '2026-10-14',
      startDate: '2026-10-14',
    },
  });
  return user;
}

async function createReplacementSet(userId: string, sentenceId: string, slug: string, options: { withApplication?: boolean } = {}) {
  const previous = await db.sentenceVersion.findFirst({ where: { sentenceId }, orderBy: { versionNumber: 'desc' } });
  const version = await db.sentenceVersion.create({
    data: {
      sentenceId,
      versionNumber: (previous?.versionNumber ?? 0) + 1,
      prompt: `Prompt ${slug}`,
      meaning: `Meaning ${slug}`,
      target: `Target ${slug}.`,
      acceptedAnswers: [`Target ${slug}.`],
      hint: `Hint ${slug}`,
      explanation: `Explanation ${slug}`,
      level: 'A1',
      status: 'PUBLISHED',
      applicationQuestions: options.withApplication
        ? {
          create: {
            prompt: `Apply ${slug}`,
            meaning: `Apply meaning ${slug}`,
            target: `Apply target ${slug}.`,
            acceptedAnswers: [`Apply target ${slug}.`],
            explanation: `Apply explanation ${slug}`,
            status: 'PUBLISHED',
          },
        }
        : undefined,
    },
  });
  const set = await db.studySet.create({
    data: {
      title: `Assessment set ${slug} ${runId}`,
      description: `Description ${slug}`,
      category: 'SITUATION',
      level: 'A1',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      sentences: { create: { sentenceVersionId: version.id, order: 1 } },
      enrollments: { create: { userId } },
    },
  });
  createdSetIds.add(set.id);
  return { version, set };
}

async function createPublishedSet(userId: string, slug: string, options: { withApplication?: boolean } = {}) {
  const sentence = await db.sentence.create({ data: {} });
  createdSentenceIds.add(sentence.id);
  const version = await db.sentenceVersion.create({
    data: {
      sentenceId: sentence.id,
      versionNumber: 1,
      prompt: `Prompt ${slug}`,
      meaning: `Meaning ${slug}`,
      target: `Target ${slug}.`,
      acceptedAnswers: [`Target ${slug}.`],
      hint: `Hint ${slug}`,
      explanation: `Explanation ${slug}`,
      level: 'A1',
      status: 'PUBLISHED',
      applicationQuestions: options.withApplication
        ? {
          create: {
            prompt: `Apply ${slug}`,
            meaning: `Apply meaning ${slug}`,
            target: `Apply target ${slug}.`,
            acceptedAnswers: [`Apply target ${slug}.`],
            explanation: `Apply explanation ${slug}`,
            status: 'PUBLISHED',
          },
        }
        : undefined,
    },
  });
  const set = await db.studySet.create({
    data: {
      title: `Assessment set ${slug} ${runId}`,
      description: `Description ${slug}`,
      category: 'SITUATION',
      level: 'A1',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      sentences: { create: { sentenceVersionId: version.id, order: 1 } },
      enrollments: { create: { userId } },
    },
  });
  createdSetIds.add(set.id);
  return { sentence, version, set };
}

async function createSessionItem(userId: string, sentenceId: string, versionId: string, now: Date, purpose = 'ASSESSMENT') {
  const session = await db.studySession.create({
    data: {
      userId,
      mode: 'WRITTEN',
      purpose,
      status: 'ACTIVE',
      studyDate: '2026-10-14',
      createdAt: now,
      items: {
        create: {
          sentenceId,
          sentenceVersionId: versionId,
          prompt: 'Prompt',
          meaning: 'Meaning',
          position: 1,
        },
      },
    },
    include: { items: true },
  });
  return session.items[0]!;
}

async function createPendingDailySession(userId: string, items: { sentenceId: string; versionId: string }[], now: Date) {
  return db.studySession.create({
    data: {
      userId,
      mode: 'WRITTEN',
      purpose: 'DAILY',
      status: 'ACTIVE',
      studyDate: '2026-10-14',
      timezone: 'Asia/Seoul',
      createdAt: now,
      items: {
        create: items.map((item, index) => ({
          sentenceId: item.sentenceId,
          sentenceVersionId: item.versionId,
          prompt: `Pending ${index}`,
          meaning: `Pending meaning ${index}`,
          position: index + 1,
          estimatedSeconds: 30,
        })),
      },
    },
  });
}

async function seedWrittenReview(userId: string, slug: string, performedAt: Date) {
  const version = await db.sentenceVersion.findFirstOrThrow({ where: { prompt: `Prompt ${slug}` } });
  const item = await createSessionItem(userId, version.sentenceId, version.id, performedAt);
  await db.reviewEvent.create({
    data: {
      userId,
      sessionItemId: item.id,
      eventId: randomUUID(),
      result: 'CORRECT',
      correct: true,
      targetSnapshot: version.target,
      acceptedAnswers: version.acceptedAnswers,
      explanation: version.explanation,
      performedAt,
      createdAt: performedAt,
    },
  });
}
