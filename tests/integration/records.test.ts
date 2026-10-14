import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({ path: '.env.local', quiet: true });

type Db = typeof import('@/server/db')['db'];
type Records = typeof import('@/server/services/records');
type ApplicationQuestions = typeof import('@/server/services/application-questions');

let db: Db;
let records: Records;
let applicationQuestions: ApplicationQuestions;

const runId = randomUUID();
const createdUserIds = new Set<string>();
const createdSetIds = new Set<string>();
const createdSentenceIds = new Set<string>();

describe('M5 records integration', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required. Run pnpm local:setup before integration tests.');
    const hostname = new URL(databaseUrl).hostname;
    if (!['127.0.0.1', 'localhost'].includes(hostname)) throw new Error(`Refusing non-local database host: ${hostname}`);
    ({ db } = await import('@/server/db'));
    records = await import('@/server/services/records');
    applicationQuestions = await import('@/server/services/application-questions');
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

  it('stores learner notes and hiding expires active automatic sessions', async () => {
    const user = await createUser('preference');
    const { sentence, version } = await createPublishedSet(user.id, 'preference');
    await db.studySession.createMany({
      data: [
        { id: `daily-${runId.slice(0, 8)}`, userId: user.id, purpose: 'DAILY', mode: 'WRITTEN', status: 'ACTIVE', studyDate: '2026-10-14' },
        { id: `assessment-${runId.slice(0, 8)}`, userId: user.id, purpose: 'ASSESSMENT', mode: 'WRITTEN', status: 'ACTIVE', studyDate: '2026-10-14' },
      ],
    });

    const preference = await records.updateSentencePreference(user.id, {
      sentenceId: sentence.id,
      note: 'needs a travel example',
      hidden: true,
      selfReportedMemorized: true,
    });
    const active = await db.studySession.count({ where: { userId: user.id, status: 'ACTIVE', purpose: { in: ['DAILY', 'ASSESSMENT'] } } });

    expect(preference).toMatchObject({ note: 'needs a travel example', hidden: true, selfReportedMemorized: true });
    expect(active).toBe(0);
    await expect(records.createContentReport(user.id, { sentenceVersionId: version.id, reason: 'OTHER', detail: 'looks good' })).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('allows reports only for the exact published or practiced sentence version', async () => {
    const user = await createUser('report-version');
    const { sentence } = await createPublishedSet(user.id, 'report-version');
    const draftVersion = await db.sentenceVersion.create({
      data: versionInput(sentence.id, 'report-version-draft', 2, 'DRAFT'),
    });

    await expect(records.createContentReport(user.id, {
      sentenceVersionId: draftVersion.id,
      reason: 'TYPO',
      detail: 'should not be visible',
    })).rejects.toMatchObject({ status: 403 });

    await createReview(user.id, sentence.id, draftVersion.id, new Date('2026-10-14T02:00:00.000Z'), '2026-10-14');

    await expect(records.createContentReport(user.id, {
      sentenceVersionId: draftVersion.id,
      reason: 'TYPO',
      detail: 'I practiced this exact version',
    })).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('returns every day in a month with studyDate snapshots and UTC fallback counts', async () => {
    const user = await createUser('calendar');
    const { sentence, version } = await createPublishedSet(user.id, 'calendar');
    await createReview(user.id, sentence.id, version.id, new Date('2026-10-31T23:30:00.000Z'), '2026-10-15', { result: 'CORRECT', qualified: true });
    await createReview(user.id, sentence.id, version.id, new Date('2026-10-20T01:00:00.000Z'), null, { result: 'INCORRECT' });
    const calendar = await records.getCalendarMonth(user.id, '2026-10');

    expect(calendar.days).toHaveLength(31);
    expect(calendar.days.find((day) => day.date === '2026-10-15')).toMatchObject({ total: 1, writtenCorrect: 1, qualified: 1 });
    expect(calendar.days.find((day) => day.date === '2026-10-20')).toMatchObject({ total: 1, wrong: 1, utcFallbackCount: 1 });
  });

  it('buckets scheduled session items by user local date and excludes abandoned sessions', async () => {
    const user = await createUser('calendar-boundary');
    const { sentence, version } = await createPublishedSet(user.id, 'calendar-boundary');
    const scheduledAt = new Date('2026-09-30T15:30:00.000Z');
    await db.studySession.create({
      data: {
        userId: user.id,
        purpose: 'DAILY',
        mode: 'WRITTEN',
        status: 'ACTIVE',
        studyDate: null,
        timezone: 'Asia/Seoul',
        items: {
          create: {
            sentenceId: sentence.id,
            sentenceVersionId: version.id,
            prompt: 'Prompt',
            meaning: 'Meaning',
            position: 1,
            scheduledAt,
          },
        },
      },
    });
    await db.studySession.create({
      data: {
        userId: user.id,
        purpose: 'DAILY',
        mode: 'WRITTEN',
        status: 'ABANDONED',
        studyDate: null,
        timezone: 'Asia/Seoul',
        items: {
          create: {
            sentenceId: sentence.id,
            sentenceVersionId: version.id,
            prompt: 'Prompt',
            meaning: 'Meaning',
            position: 1,
            scheduledAt,
          },
        },
      },
    });
    await db.studySession.create({
      data: {
        userId: user.id,
        purpose: 'DAILY',
        mode: 'WRITTEN',
        status: 'COMPLETED',
        studyDate: '2026-10-02',
        timezone: 'Asia/Seoul',
        items: {
          create: {
            sentenceId: sentence.id,
            sentenceVersionId: version.id,
            prompt: 'Prompt',
            meaning: 'Meaning',
            position: 1,
            scheduledAt: new Date('2026-11-10T01:00:00.000Z'),
          },
        },
      },
    });

    const calendar = await records.getCalendarMonth(user.id, '2026-10');

    expect(calendar.days.find((day) => day.date === '2026-10-01')).toMatchObject({ scheduledDueCount: 1 });
    expect(calendar.days.find((day) => day.date === '2026-10-02')).toMatchObject({ scheduledDueCount: 1 });
  });

  it('keeps application questions immutable after review starts and reports admin quality denominators', async () => {
    const user = await createUser('application-admin');
    const { version } = await createPublishedSet(user.id, 'application-admin');
    const question = await applicationQuestions.adminCreateApplicationQuestion({
      sentenceVersionId: version.id,
      prompt: 'New situation',
      meaning: '새 상황',
      target: 'Application target.',
      acceptedAnswers: ['Application target.'],
      explanation: 'Use the same pattern.',
    });

    await applicationQuestions.adminUpdateApplicationQuestion(question.id, { status: 'REVIEW' });
    await expect(applicationQuestions.adminUpdateApplicationQuestion(question.id, {
      sentenceVersionId: version.id,
      prompt: 'Changed',
      meaning: 'Changed',
      target: 'Changed.',
      acceptedAnswers: ['Changed.'],
      explanation: 'Changed',
    })).rejects.toMatchObject({ status: 409 });
    await applicationQuestions.adminUpdateApplicationQuestion(question.id, { status: 'PUBLISHED' });
    const metrics = await records.getQualityMetrics();

    expect(metrics.denominators).toHaveProperty('reports');
    expect(metrics.applicationQuestions.some((row) => row.status === 'PUBLISHED')).toBe(true);
  });

  it('does not let a stale edit mutate a question after publication wins the row lock', async () => {
    const user = await createUser('application-race');
    const { version } = await createPublishedSet(user.id, 'application-race');
    const question = await applicationQuestions.adminCreateApplicationQuestion({
      sentenceVersionId: version.id,
      prompt: 'Race prompt',
      meaning: 'Race meaning',
      target: 'Race target.',
      acceptedAnswers: ['Race target.'],
      explanation: 'Race explanation.',
    });
    await applicationQuestions.adminUpdateApplicationQuestion(question.id, { status: 'REVIEW' });

    const results = await Promise.allSettled([
      applicationQuestions.adminUpdateApplicationQuestion(question.id, { status: 'PUBLISHED' }),
      applicationQuestions.adminUpdateApplicationQuestion(question.id, {
        sentenceVersionId: version.id,
        prompt: 'Late edit prompt',
        meaning: 'Late edit meaning',
        target: 'Late edit target.',
        acceptedAnswers: ['Late edit target.'],
        explanation: 'Late edit explanation.',
      }),
    ]);
    const stored = await db.applicationQuestion.findUniqueOrThrow({ where: { id: question.id } });

    expect(results.some((result) => result.status === 'rejected' && 'reason' in result && result.reason.status === 409)).toBe(true);
    expect(stored).toMatchObject({ status: 'PUBLISHED', prompt: 'Race prompt', target: 'Race target.' });
  });
});

async function createUser(slug: string) {
  const user = await db.appUser.create({
    data: { id: randomUUID(), email: `${slug}-${runId}@records.test`, displayName: slug, onboarded: true },
  });
  createdUserIds.add(user.id);
  return user;
}

async function createPublishedSet(userId: string, slug: string) {
  const sentence = await db.sentence.create({ data: {} });
  createdSentenceIds.add(sentence.id);
  const version = await db.sentenceVersion.create({ data: versionInput(sentence.id, slug, 1, 'PUBLISHED') });
  const set = await db.studySet.create({
    data: {
      title: `Records ${slug} ${runId}`,
      description: slug,
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

function versionInput(sentenceId: string, slug: string, versionNumber: number, status: 'DRAFT' | 'PUBLISHED') {
  return {
    sentenceId,
    versionNumber,
    prompt: `Prompt ${slug}`,
    meaning: `Meaning ${slug}`,
    target: `Target ${slug}.`,
    acceptedAnswers: [`Target ${slug}.`],
    hint: `Hint ${slug}`,
    explanation: `Explanation ${slug}`,
    language: 'en',
    level: 'A1' as const,
    status,
  };
}

async function createReview(
  userId: string,
  sentenceId: string,
  sentenceVersionId: string,
  performedAt: Date,
  studyDate: string | null,
  options: { result?: 'CORRECT' | 'INCORRECT'; qualified?: boolean } = {},
) {
  const session = await db.studySession.create({
    data: { userId, purpose: 'PRACTICE', mode: 'WRITTEN', status: 'COMPLETED', studyDate, timezone: 'Asia/Seoul' },
  });
  const item = await db.sessionItem.create({
    data: { sessionId: session.id, sentenceId, sentenceVersionId, prompt: 'Prompt', meaning: 'Meaning', position: 1 },
  });
  return db.reviewEvent.create({
    data: {
      userId,
      sessionItemId: item.id,
      eventId: randomUUID(),
      answer: 'answer',
      result: options.result ?? 'CORRECT',
      correct: (options.result ?? 'CORRECT') === 'CORRECT',
      targetSnapshot: 'Target.',
      acceptedAnswers: ['Target.'],
      explanation: 'Explanation',
      performedAt,
      createdAt: performedAt,
      studyDate,
      timezone: studyDate ? 'Asia/Seoul' : null,
      qualified: options.qualified ?? false,
    },
  });
}
