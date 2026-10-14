import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { localDate } from '@/domain/scheduling';

config({ path: '.env.local', quiet: true });

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://audio.test/${path}` }, error: null }),
      }),
    },
  }),
}));

type Db = typeof import('@/server/db')['db'];
type ContentServices = typeof import('@/server/services/content');
type LearningServices = typeof import('@/server/services/learning');
type SchedulingServices = typeof import('@/server/services/scheduling');
type StudyMode = 'WRITTEN' | 'SPOKEN';
type AnswerInput = { itemId: string; eventId: string; answer?: string; selfRating?: 'AGAIN' | 'GOOD'; hard?: boolean };
type PlanInput = Parameters<SchedulingServices['updateStudyPlan']>[1];

let db: Db;
let content: ContentServices;
let learning: LearningServices & {
  setEnrollmentPaused: (userId: string, setId: string, paused: boolean) => Promise<{ ok: true }>;
  getSession: (userId: string, id: string, now?: Date) => Promise<{
    id: string;
    status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
    items: { id: string; prompt: string; meaning: string; position: number; answered: boolean }[];
    completedCount: number;
  }>;
  answerSessionItem: (userId: string, sessionId: string, input: AnswerInput, now?: Date) => Promise<{
    correct: boolean | null;
    result: 'CORRECT' | 'INCORRECT' | 'ASSISTED' | 'SELF_REPORTED';
    nextDueAt: string | null;
    reviewStep: number | null;
    qualified: boolean;
    reviewReason: string | null;
    completed: boolean;
  }>;
  revealSessionItem: (userId: string, sessionId: string, input: { itemId: string; kind: 'HINT' | 'ANSWER' }, now?: Date) => Promise<{ text: string; audioUrl?: string }>;
};
let scheduling: SchedulingServices;

const dayMs = 24 * 60 * 60 * 1000;
const runId = randomUUID();
const emailDomain = `${runId}.scheduling.test`;
const createdUserIds = new Set<string>();
const createdSetIds = new Set<string>();
const createdSentenceIds = new Set<string>();
const createdAudioAssetIds = new Set<string>();

describe('M4 scheduling integration', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required. Run pnpm local:setup before integration tests.');
    const hostname = new URL(databaseUrl).hostname;
    if (!['127.0.0.1', 'localhost'].includes(hostname)) {
      throw new Error(`Refusing to run integration tests against non-local database host: ${hostname}`);
    }

    ({ db } = await import('@/server/db'));
    content = await import('@/server/services/content');
    learning = await import('@/server/services/learning') as typeof learning;
    scheduling = await import('@/server/services/scheduling');
    await db.$queryRaw`select 1`;
  });

  afterAll(async () => {
    if (!db) return;
    await db.appUser.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    await db.setSentence.deleteMany({ where: { setId: { in: [...createdSetIds] } } });
    await db.studySet.deleteMany({ where: { id: { in: [...createdSetIds] } } });
    await db.sentenceVersion.deleteMany({ where: { sentenceId: { in: [...createdSentenceIds] } } });
    await db.sentence.deleteMany({ where: { id: { in: [...createdSentenceIds] } } });
    await db.audioAsset.deleteMany({ where: { id: { in: [...createdAudioAssetIds] } } });
    await db.$disconnect();
  });

  it('schedules first written success one day later without qualified recall', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('first-success');
    const { sentence } = await enrollPublishedSet(user.id, 'first-success');
    await configurePlan(user.id, now);
    const item = await createDailyItem(user.id, 'WRITTEN', now);

    const answer = await answerWritten(user.id, item.sessionId, item.itemId, 'first-success', now);
    const state = await stateFor(user.id, sentence.sentenceId, 'WRITTEN');

    expect(answer).toMatchObject({ result: 'CORRECT', reviewStep: 0, qualified: false, reviewReason: 'written-first-success' });
    expect(answer.nextDueAt).toBe(daysFrom(now, 1).toISOString());
    expect(state).toMatchObject({ reviewStep: 0, qualifiedRecallCount: 0 });
    expect(state.dueAt?.toISOString()).toBe(daysFrom(now, 1).toISOString());
  });

  it('advances a due written review from step 0 to the three-day interval', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('due-advance');
    const { sentence } = await enrollPublishedSet(user.id, 'due-advance');
    await configurePlan(user.id, now);
    await seedState(user.id, sentence.sentenceId, 'WRITTEN', { reviewStep: 0, dueAt: daysFrom(now, -1), lastPracticedAt: daysFrom(now, -3) });
    await seedExposure(user.id, sentence.sentenceId, daysFrom(now, -2));
    const item = await createDailyItem(user.id, 'WRITTEN', now);

    const answer = await answerWritten(user.id, item.sessionId, item.itemId, 'due-advance', now);
    const event = await db.reviewEvent.findUniqueOrThrow({ where: { sessionItemId: item.itemId } });

    expect(answer).toMatchObject({ reviewStep: 1, qualified: true, reviewReason: 'written-qualified' });
    expect(answer.nextDueAt).toBe(daysFrom(now, 3).toISOString());
    expect(event).toMatchObject({ reviewStep: 1, qualified: true, reviewReason: 'written-qualified' });
    expect(event.nextDueAt?.toISOString()).toBe(daysFrom(now, 3).toISOString());
  });

  it('keeps the interval when a due written review is marked hard', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('hard-review');
    const { sentence } = await enrollPublishedSet(user.id, 'hard-review');
    await configurePlan(user.id, now);
    await seedState(user.id, sentence.sentenceId, 'WRITTEN', { reviewStep: 2, dueAt: daysFrom(now, -1), lastPracticedAt: daysFrom(now, -8), qualifiedRecallCount: 4 });
    await seedExposure(user.id, sentence.sentenceId, daysFrom(now, -2));
    const item = await createDailyItem(user.id, 'WRITTEN', now);

    const answer = await learning.answerSessionItem(user.id, item.sessionId, {
      itemId: item.itemId,
      eventId: randomUUID(),
      answer: targetFor('hard-review'),
      hard: true,
    }, now);

    expect(answer).toMatchObject({ reviewStep: 2, qualified: true, reviewReason: 'written-qualified-hard' });
    expect(answer.nextDueAt).toBe(daysFrom(now, 7).toISOString());
  });

  it('does not advance a due written review within 24 hours of a cross-mode exposure', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('recent-exposure');
    const { set, sentence } = await enrollPublishedSet(user.id, 'recent-exposure');
    await configurePlan(user.id, now);
    await seedState(user.id, sentence.sentenceId, 'WRITTEN', { reviewStep: 2, dueAt: daysFrom(now, -1), lastPracticedAt: daysFrom(now, -8), qualifiedRecallCount: 2 });
    await seedExposure(user.id, sentence.sentenceId, new Date(now.getTime() - 2 * 60 * 60 * 1000));
    const practiceSession = await learning.createStudySession(user.id, { setId: set.id, mode: 'WRITTEN' });
    const practiceItem = (await learning.getSession(user.id, practiceSession.id)).items[0]!;

    const answer = await answerWritten(user.id, practiceSession.id, practiceItem.id, 'recent-exposure', now);

    expect(answer).toMatchObject({ reviewStep: 2, qualified: false, reviewReason: 'written-recent-exposure' });
    expect(answer.nextDueAt).toBe(daysFrom(now, 1).toISOString());
  });

  it('resets an assisted written review to the one-day interval', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('assisted-reset');
    const { sentence } = await enrollPublishedSet(user.id, 'assisted-reset');
    await configurePlan(user.id, now);
    await seedState(user.id, sentence.sentenceId, 'WRITTEN', { reviewStep: 3, dueAt: daysFrom(now, -1), lastPracticedAt: daysFrom(now, -15), qualifiedRecallCount: 5 });
    const item = await createDailyItem(user.id, 'WRITTEN', now);

    await learning.revealSessionItem(user.id, item.sessionId, { itemId: item.itemId, kind: 'HINT' }, now);
    const answer = await answerWritten(user.id, item.sessionId, item.itemId, 'assisted-reset', now);

    expect(answer).toMatchObject({ result: 'ASSISTED', reviewStep: 0, qualified: false, reviewReason: 'written-relearn' });
    expect(answer.nextDueAt).toBe(daysFrom(now, 1).toISOString());
  });

  it('returns the same scheduling snapshot when an answer event is replayed', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('replay-snapshot');
    await enrollPublishedSet(user.id, 'replay-snapshot');
    await configurePlan(user.id, now);
    const item = await createDailyItem(user.id, 'WRITTEN', now);
    const input = { itemId: item.itemId, eventId: randomUUID(), answer: targetFor('replay-snapshot') };

    const first = await learning.answerSessionItem(user.id, item.sessionId, input, now);
    const second = await learning.answerSessionItem(user.id, item.sessionId, input, daysFrom(now, 3));

    expect(second).toEqual(first);
  });

  it('persists one review event when identical simultaneous submits reuse an event id', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('same-event-once');
    await enrollPublishedSet(user.id, 'same-event-once');
    await configurePlan(user.id, now);
    const item = await createDailyItem(user.id, 'WRITTEN', now);
    const input = { itemId: item.itemId, eventId: randomUUID(), answer: targetFor('same-event-once') };

    const results = await Promise.allSettled([
      learning.answerSessionItem(user.id, item.sessionId, input, now),
      learning.answerSessionItem(user.id, item.sessionId, input, now),
    ]);
    const persisted = await db.reviewEvent.count({ where: { sessionItemId: item.itemId } });

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(persisted).toBe(1);
  });

  it('deduplicates one active shared sentence across enrolled sets in the same mode queue', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('queue-dedup');
    const audio = await createReadyAudio('queue-dedup');
    const sentence = await content.adminCreateSentence(sentenceInput('queue-dedup', audio.id));
    trackSentence(sentence.sentenceId);
    const first = await publishSet('queue-dedup-one', [sentence.id]);
    const second = await publishSet('queue-dedup-two', [sentence.id]);
    await learning.enrollSet(user.id, first.id);
    await learning.enrollSet(user.id, second.id);
    await configurePlan(user.id, now);

    const queue = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);

    expect(queue.items.map((item) => item.sentenceId)).toEqual([sentence.sentenceId]);
  });

  it('keeps a shared sentence available when only one enrolled set is paused', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('pause-one-shared');
    const audio = await createReadyAudio('pause-one-shared');
    const sentence = await content.adminCreateSentence(sentenceInput('pause-one-shared', audio.id));
    trackSentence(sentence.sentenceId);
    const pausedSet = await publishSet('pause-one-shared-a', [sentence.id]);
    const activeSet = await publishSet('pause-one-shared-b', [sentence.id]);
    await learning.enrollSet(user.id, pausedSet.id);
    await learning.enrollSet(user.id, activeSet.id);
    await learning.setEnrollmentPaused(user.id, pausedSet.id, true);
    await configurePlan(user.id, now);

    const queue = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ sentenceId: sentence.sentenceId, setTitle: activeSet.title });
  });

  it('excludes a sentence after the last set containing it is unenrolled while preserving review state', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('unenroll-preserve');
    const { set, sentence } = await enrollPublishedSet(user.id, 'unenroll-preserve');
    await configurePlan(user.id, now);
    await seedState(user.id, sentence.sentenceId, 'WRITTEN', { reviewStep: 1, dueAt: daysFrom(now, -1), lastPracticedAt: daysFrom(now, -4) });

    await learning.unenrollSet(user.id, set.id);
    const queue = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);
    const state = await stateFor(user.id, sentence.sentenceId, 'WRITTEN');

    expect(queue.items.find((item) => item.sentenceId === sentence.sentenceId)).toBeUndefined();
    expect(state.reviewStep).toBe(1);
  });

  it('applies weekday add and skip exceptions to the today queue', async () => {
    const now = new Date('2026-10-15T01:00:00.000Z');
    const user = await createUser('weekday-exceptions');
    await enrollPublishedSet(user.id, 'weekday-exceptions');
    await configurePlan(user.id, now, {
      weekdays: [1],
      startDate: '2026-10-13',
      exceptions: [{ date: '2026-10-15', kind: 'ADD' }],
    });

    const added = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);
    await configurePlan(user.id, now, {
      weekdays: [1],
      startDate: '2026-10-13',
      exceptions: [{ date: '2026-10-15', kind: 'SKIP' }],
    });
    const skipped = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);

    expect(added.isStudyDay).toBe(true);
    expect(skipped.isStudyDay).toBe(false);
  });

  it('applies N-day interval rules from the local anchor date', async () => {
    const now = new Date('2026-10-17T01:00:00.000Z');
    const user = await createUser('interval-rule');
    await enrollPublishedSet(user.id, 'interval-rule');
    await configurePlan(user.id, now, {
      ruleType: 'INTERVAL',
      weekdays: [],
      intervalDays: 3,
      anchorDate: '2026-10-14',
      startDate: '2026-10-15',
    });

    const queue = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);

    expect(queue).toMatchObject({ localDate: '2026-10-17', isStudyDay: true });
    expect(queue.items).toHaveLength(1);
  });

  it('uses review budget before new items and defers excess overdue reviews', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('budget-review-first');
    const { sentences } = await enrollPublishedSet(user.id, 'budget-review-first', [
      'budget-review-first-due-a',
      'budget-review-first-due-b',
      'budget-review-first-due-c',
      'budget-review-first-due-d',
      'budget-review-first-due-e',
      'budget-review-first-due-f',
      'budget-review-first-due-g',
      'budget-review-first-new',
    ]);
    await configurePlan(user.id, now, { dailyMinutes: 3 });
    for (const sentence of sentences.slice(0, 7)) {
      await seedState(user.id, sentence.sentenceId, 'WRITTEN', { reviewStep: 1, dueAt: daysFrom(now, -2), lastPracticedAt: daysFrom(now, -5) });
    }

    const queue = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);

    expect(queue.items.map((item) => item.kind)).toEqual(['REVIEW', 'REVIEW', 'REVIEW', 'REVIEW', 'REVIEW', 'REVIEW']);
    expect(queue.newCount).toBe(0);
    expect(queue.deferredCount).toBe(1);
  });

  it('caps recovery queues at three minutes and persists recovery after issuing the first session', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('recovery-cap');
    const { sentences } = await enrollPublishedSet(user.id, 'recovery-cap', ['recovery-cap-a', 'recovery-cap-b', 'recovery-cap-c', 'recovery-cap-d', 'recovery-cap-e', 'recovery-cap-f', 'recovery-cap-g']);
    await configurePlan(user.id, now, { dailyMinutes: 10 });
    for (const sentence of sentences) {
      await seedState(user.id, sentence.sentenceId, 'WRITTEN', { reviewStep: 1, dueAt: daysFrom(now, -8), lastPracticedAt: daysFrom(now, -9) });
    }
    await seedOldReview(user.id, sentences[0]!.sentenceId, daysFrom(now, -8));

    const before = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);
    const session = await scheduling.createTodaySession(user.id, 'WRITTEN', now);
    const after = await scheduling.getTodayQueue(user.id, 'WRITTEN', new Date(now.getTime() + 60 * 60 * 1000));

    expect(before).toMatchObject({ recovery: true, effectiveMinutes: 3 });
    expect((await db.studySession.findUniqueOrThrow({ where: { id: session.id }, include: { items: true } })).items).toHaveLength(6);
    expect(after.recovery).toBe(true);
  });

  it('reuses the same same-day daily session under concurrent creation', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('same-day-session');
    await enrollPublishedSet(user.id, 'same-day-session');
    await configurePlan(user.id, now);

    const [first, second] = await Promise.all([
      scheduling.createTodaySession(user.id, 'WRITTEN', now),
      scheduling.createTodaySession(user.id, 'WRITTEN', now),
    ]);

    expect(second.id).toBe(first.id);
  });

  it('reserves pending daily items across modes against the same daily budget', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('cross-mode-budget');
    await enrollPublishedSet(user.id, 'cross-mode-budget', ['cross-mode-budget-a', 'cross-mode-budget-b', 'cross-mode-budget-c']);
    await configurePlan(user.id, now, { dailyMinutes: 3 });

    const written = await scheduling.createTodaySession(user.id, 'WRITTEN', now);
    const spokenQueue = await scheduling.getTodayQueue(user.id, 'SPOKEN', now);

    expect((await db.studySession.findUniqueOrThrow({ where: { id: written.id }, include: { items: true } })).items).toHaveLength(3);
    expect(spokenQueue.items).toEqual([]);
  });

  it('excludes archived sets from today queue even when the user remains enrolled', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('archived-excluded');
    const { set } = await enrollPublishedSet(user.id, 'archived-excluded');
    await configurePlan(user.id, now);

    await content.adminUpdateSet(set.id, { status: 'ARCHIVED' });
    const queue = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);

    expect(queue.items).toEqual([]);
  });

  it('keeps submitted study-date snapshots immutable after timezone edits', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('timezone-snapshot');
    await enrollPublishedSet(user.id, 'timezone-snapshot');
    await configurePlan(user.id, now, { timezone: 'Asia/Seoul', localTime: '09:00' });
    const item = await createDailyItem(user.id, 'WRITTEN', now);

    await answerWritten(user.id, item.sessionId, item.itemId, 'timezone-snapshot', now);
    await configurePlan(user.id, now, { timezone: 'America/Los_Angeles', localTime: '09:00' });
    const event = await db.reviewEvent.findUniqueOrThrow({ where: { sessionItemId: item.itemId } });

    expect(event.studyDate).toBe('2026-10-14');
    expect(event.timezone).toBe('Asia/Seoul');
  });

  it('abandons old daily sessions and rejects new submissions to expired items', async () => {
    const yesterday = new Date('2026-10-14T01:00:00.000Z');
    const today = daysFrom(yesterday, 1);
    const user = await createUser('old-session-expiry');
    await enrollPublishedSet(user.id, 'old-session-expiry', ['old-session-expiry-a', 'old-session-expiry-b']);
    await configurePlan(user.id, yesterday, { weekdays: [3, 4] });
    const oldItem = await createDailyItem(user.id, 'WRITTEN', yesterday);

    await scheduling.createTodaySession(user.id, 'WRITTEN', today);
    const oldSession = await db.studySession.findUniqueOrThrow({ where: { id: oldItem.sessionId } });

    await expect(answerWritten(user.id, oldItem.sessionId, oldItem.itemId, 'old-session-expiry-a', today)).rejects.toMatchObject({ status: 409 });
    expect(oldSession.status).toBe('ABANDONED');
  });

  it('expires a daily session on the next local day before any reveal or answer', async () => {
    const today = new Date('2026-10-14T01:00:00.000Z');
    const tomorrow = daysFrom(today, 1);
    const user = await createUser('next-day-expiry');
    await enrollPublishedSet(user.id, 'next-day-expiry');
    await configurePlan(user.id, today, { weekdays: [3, 4] });
    const item = await createDailyItem(user.id, 'WRITTEN', today);

    const dto = await learning.getSession(user.id, item.sessionId, tomorrow);

    await expect(learning.revealSessionItem(user.id, item.sessionId, { itemId: item.itemId, kind: 'HINT' }, tomorrow)).rejects.toMatchObject({ status: 409 });
    await expect(answerWritten(user.id, item.sessionId, item.itemId, 'next-day-expiry', tomorrow)).rejects.toMatchObject({ status: 409 });
    expect(dto.status).toBe('ABANDONED');
  });

  it('invalidates pending daily items when their only source set is archived after issuance', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('archive-after-issue');
    const { set, sentence } = await enrollPublishedSet(user.id, 'archive-after-issue');
    await configurePlan(user.id, now);
    const item = await createDailyItem(user.id, 'WRITTEN', now);

    await content.adminUpdateSet(set.id, { status: 'ARCHIVED' });
    const queue = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);

    await expect(learning.revealSessionItem(user.id, item.sessionId, { itemId: item.itemId, kind: 'HINT' }, now)).rejects.toMatchObject({ status: 409 });
    await expect(answerWritten(user.id, item.sessionId, item.itemId, 'archive-after-issue', now)).rejects.toMatchObject({ status: 409 });
    await expect(db.userSentenceState.findUnique({ where: { userId_sentenceId_mode: { userId: user.id, sentenceId: sentence.sentenceId, mode: 'WRITTEN' } } })).resolves.toBeNull();
    await expect(db.reviewEvent.count({ where: { sessionItemId: item.itemId } })).resolves.toBe(0);
    expect(queue).toMatchObject({ activeSessionId: null, items: [] });
  });

  it('returns no next study time when the open study window has no assignable items', async () => {
    const now = new Date('2026-10-14T01:00:00.000Z');
    const user = await createUser('empty-open-window');
    await configurePlan(user.id, now);

    const queue = await scheduling.getTodayQueue(user.id, 'WRITTEN', now);

    expect(queue).toMatchObject({ isStudyDay: true, nextStudyAt: null, items: [] });
  });
});

async function enrollPublishedSet(userId: string, slug: string, sentenceSlugs = [slug]) {
  const { set, sentence, sentences } = await createPublishedLearningSet(slug, sentenceSlugs);
  await learning.enrollSet(userId, set.id);
  return { set, sentence, sentences };
}

async function createPublishedLearningSet(slug: string, sentenceSlugs = [slug]) {
  const sentences = [];
  for (const sentenceSlug of sentenceSlugs) {
    const audio = await createReadyAudio(sentenceSlug);
    const sentence = await content.adminCreateSentence(sentenceInput(sentenceSlug, audio.id));
    trackSentence(sentence.sentenceId);
    sentences.push(sentence);
  }
  const set = await publishSet(slug, sentences.map((sentence) => sentence.id));
  return { set, sentence: sentences[0]!, sentences };
}

async function publishSet(slug: string, sentenceVersionIds: string[]) {
  const set = await content.adminCreateSet(setInput(slug, sentenceVersionIds));
  trackSet(set.id);
  await content.adminReviewSet(set.id);
  return content.adminPublishSet(set.id);
}

async function createDailyItem(userId: string, mode: StudyMode, now: Date) {
  const session = await scheduling.createTodaySession(userId, mode, now);
  const dto = await learning.getSession(userId, session.id);
  const item = dto.items[0];
  if (!item) throw new Error(`Expected ${mode} session ${session.id} to have an item`);
  return { sessionId: session.id, itemId: item.id };
}

async function answerWritten(userId: string, sessionId: string, itemId: string, slug: string, now: Date) {
  return learning.answerSessionItem(userId, sessionId, { itemId, eventId: randomUUID(), answer: targetFor(slug) }, now);
}

async function configurePlan(userId: string, now: Date, overrides: Partial<PlanInput> = {}) {
  const date = localDate(now, overrides.timezone ?? 'Asia/Seoul');
  const input = {
    displayName: `Scheduler ${runId}`,
    dailyMinutes: 20,
    timezone: 'Asia/Seoul',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    ruleType: 'WEEKDAYS',
    intervalDays: 2,
    anchorDate: date,
    startDate: date,
    targetDate: null,
    localTime: '09:00',
    paused: false,
    exceptions: [],
    ...overrides,
  } satisfies PlanInput;
  return scheduling.updateStudyPlan(userId, input, now);
}

async function seedState(
  userId: string,
  sentenceId: string,
  mode: StudyMode,
  overrides: Partial<{
    lastResult: 'CORRECT' | 'INCORRECT' | 'ASSISTED' | 'SELF_REPORTED';
    lastPracticedAt: Date;
    correctCount: number;
    reviewStep: number;
    dueAt: Date | null;
    qualifiedRecallCount: number;
    lastQualifiedAt: Date | null;
  }> = {},
) {
  const lastPracticedAt = overrides.lastPracticedAt ?? new Date('2026-10-01T00:00:00.000Z');
  return db.userSentenceState.upsert({
    where: { userId_sentenceId_mode: { userId, sentenceId, mode } },
    create: {
      userId,
      sentenceId,
      mode,
      lastResult: overrides.lastResult ?? (mode === 'WRITTEN' ? 'CORRECT' : 'SELF_REPORTED'),
      lastPracticedAt,
      correctCount: overrides.correctCount ?? (mode === 'WRITTEN' ? 1 : 0),
      reviewStep: overrides.reviewStep ?? 0,
      dueAt: overrides.dueAt ?? daysFrom(lastPracticedAt, 1),
      qualifiedRecallCount: overrides.qualifiedRecallCount ?? 0,
      lastQualifiedAt: overrides.lastQualifiedAt,
    },
    update: {
      lastResult: overrides.lastResult ?? (mode === 'WRITTEN' ? 'CORRECT' : 'SELF_REPORTED'),
      lastPracticedAt,
      correctCount: overrides.correctCount ?? (mode === 'WRITTEN' ? 1 : 0),
      reviewStep: overrides.reviewStep ?? 0,
      dueAt: overrides.dueAt ?? daysFrom(lastPracticedAt, 1),
      qualifiedRecallCount: overrides.qualifiedRecallCount ?? 0,
      lastQualifiedAt: overrides.lastQualifiedAt,
    },
  });
}

async function seedExposure(userId: string, sentenceId: string, at: Date) {
  return db.userSentencePreference.upsert({
    where: { userId_sentenceId: { userId, sentenceId } },
    create: { userId, sentenceId, lastExposedAt: at },
    update: { lastExposedAt: at },
  });
}

async function seedOldReview(userId: string, sentenceId: string, performedAt: Date) {
  const version = await db.sentenceVersion.findFirstOrThrow({ where: { sentenceId }, orderBy: { versionNumber: 'desc' } });
  await db.studySession.create({
    data: {
      userId,
      mode: 'WRITTEN',
      status: 'COMPLETED',
      purpose: 'DAILY',
      studyDate: localDate(performedAt, 'Asia/Seoul'),
      timezone: 'Asia/Seoul',
      createdAt: performedAt,
      items: {
        create: {
          sentenceId,
          sentenceVersionId: version.id,
          prompt: version.prompt,
          meaning: version.meaning,
          position: 1,
          estimatedSeconds: 30,
          reviewEvent: {
            create: {
              userId,
              eventId: randomUUID(),
              result: 'CORRECT',
              correct: true,
              targetSnapshot: version.target,
              acceptedAnswers: version.acceptedAnswers,
              explanation: version.explanation,
              performedAt,
              studyDate: localDate(performedAt, 'Asia/Seoul'),
              timezone: 'Asia/Seoul',
            },
          },
        },
      },
    },
  });
}

async function stateFor(userId: string, sentenceId: string, mode: StudyMode) {
  return db.userSentenceState.findUniqueOrThrow({ where: { userId_sentenceId_mode: { userId, sentenceId, mode } } });
}

async function createUser(slug: string) {
  const user = await db.appUser.create({
    data: {
      id: randomUUID(),
      email: `${slug}-${emailDomain}`,
      displayName: `Scheduling ${slug}`,
      onboarded: true,
    },
  });
  createdUserIds.add(user.id);
  return user;
}

async function createReadyAudio(slug: string) {
  const asset = await db.audioAsset.create({
    data: {
      path: `integration/${runId}/${slug}.wav`,
      contentType: 'audio/wav',
      size: 1,
      status: 'READY',
      completedAt: new Date(),
    },
  });
  createdAudioAssetIds.add(asset.id);
  return asset;
}

function sentenceInput(slug: string, audioAssetId?: string) {
  const target = targetFor(slug);
  return {
    prompt: `Prompt ${slug}`,
    meaning: `Meaning ${slug}`,
    target,
    acceptedAnswers: [target],
    hint: `Hint ${slug}`,
    explanation: `Explanation ${slug}`,
    language: 'en' as const,
    level: 'A1' as const,
    audioAssetId,
  };
}

function setInput(slug: string, sentenceVersionIds: string[]) {
  return {
    title: `Scheduling set ${slug} ${runId}`,
    description: `Description ${slug}`,
    category: 'SITUATION' as const,
    level: 'A1' as const,
    sentenceVersionIds,
  };
}

function targetFor(slug: string) {
  return `Integration target ${slug}.`;
}

function daysFrom(date: Date, days: number) {
  return new Date(date.getTime() + days * dayMs);
}

function trackSet(id: string) {
  createdSetIds.add(id);
}

function trackSentence(id: string) {
  createdSentenceIds.add(id);
}
