import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock('@/server/db', () => ({ db: mocks.db }));
import { createAssessmentSession, getAssessments } from '@/server/services/assessments';
import { defaultSchedule } from '@/domain/scheduling';

const now = new Date('2026-10-14T09:00:00Z');
const userId = 'exposure-user';

// Real assessment service; model only Prisma's database boundary.
function fixture(kind: 'RETENTION' | 'WEEKLY', exposureKind?: 'HINT' | 'ANSWER', exposureAt = now) {
  const version = { id: 'v1', sentenceId: 's1', prompt: 'Prompt', meaning: 'Meaning', applicationQuestions: [] };
  const cohort = { id: 'c1', userId, sentenceId: 's1', baselineVersionId: null };
  const assignment = { id: 'a1', kind: kind === 'WEEKLY' ? 'WEEKLY' : 'RETENTION_7', periodKey: 'period', cohort, sessionItemId: null, answeredAt: null, result: null, inWindow: null, opensAt: now, dueAt: now, closesAt: new Date(now.getTime() + 60_000) };
  const daily = { id: 'daily-item', sessionId: 'daily', sentenceId: 's1', sentenceVersionId: 'v1', form: 'RECALL', estimatedSeconds: 30, exposures: [] };
  const plan = { ...defaultSchedule(now), displayName: 'Exposure', weekdays: [0, 1, 2, 3, 4, 5, 6], localTime: '00:00', dailyMinutes: 3 };
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: userId }]),
    studyPlan: { findUnique: vi.fn(async () => plan) },
    enrollment: { findMany: vi.fn(async () => [{ createdAt: now, set: { sentences: [{ sentenceVersion: version }] } }]) },
    assessmentCohort: { createMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => [{ startedAt: now }]) },
    assessmentAssignment: { count: vi.fn(async () => 1), findMany: vi.fn(async () => [assignment]), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    userSentencePreference: { findMany: vi.fn(async () => []) },
    reviewEvent: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => ({ performedAt: now })) },
    exposureEvent: { findMany: vi.fn(async ({ where }: { where: { createdAt: { gte: Date; lt: Date } } }) => exposureKind && exposureAt >= where.createdAt.gte && exposureAt < where.createdAt.lt ? [{ item: { sentenceId: 's1' } }] : []) },
    sessionItem: { findMany: vi.fn(async ({ where }: { where: { exposures?: unknown } }) => exposureKind && where.exposures ? [] : [daily]) },
    studySession: {
      findMany: vi.fn(async ({ where }: { where: { purpose: unknown } }) => typeof where.purpose === 'string' ? [] : [{ items: Array.from({ length: 6 }, () => daily) }]),
      create: vi.fn(async () => { throw new Error('No budget for a new item'); }),
    },
  };
  Object.assign(mocks.db, { $transaction: async (callback: (db: typeof tx) => unknown) => callback(tx) });
  return { tx };
}

beforeEach(() => vi.clearAllMocks());

describe('assessment exposure eligibility', () => {
  it.each(['RETENTION', 'WEEKLY'] as const)('%s reuses clean daily items without reserving another item', async (kind) => {
    const { tx } = fixture(kind);
    expect(await createAssessmentSession(userId, { kind }, now)).toEqual({ id: 'daily' });
    expect(tx.assessmentAssignment.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { sessionItemId: 'daily-item' } });
    expect(tx.studySession.create).not.toHaveBeenCalled();
  });

  it.each([
    ['RETENTION', 'HINT'], ['RETENTION', 'ANSWER'], ['WEEKLY', 'HINT'], ['WEEKLY', 'ANSWER'],
  ] as const)('%s defers %s-exposed sentences instead of linking or creating fresh items', async (kind, exposure) => {
    const { tx } = fixture(kind, exposure);
    await expect(createAssessmentSession(userId, { kind }, now)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('다음 학습일') });
    expect(tx.assessmentAssignment.update).not.toHaveBeenCalled();
    expect(tx.studySession.create).not.toHaveBeenCalled();
  });

  it('does not treat a prior local-day exposure as a same-day deferral', async () => {
    const { tx } = fixture('RETENTION', 'ANSWER', new Date('2026-10-13T14:59:59Z'));
    // Yesterday's item is never reused even though today's sentence may be tested.
    tx.studySession.findMany.mockResolvedValue([]);
    tx.studySession.create.mockImplementation(async () => ({ id: 'fresh', items: [{ id: 'fresh-item', sentenceId: 's1', form: 'RECALL', sentenceVersionId: 'v1' }] }) as never);
    expect(await createAssessmentSession(userId, { kind: 'RETENTION' }, now)).toEqual({ id: 'fresh' });
    expect(tx.assessmentAssignment.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { sessionItemId: 'fresh-item' } });
  });

  it.each(['RETENTION', 'WEEKLY'] as const)('%s shows deferral without counting an answered/incorrect result', async (kind) => {
    fixture(kind, 'HINT');
    const dto = await getAssessments(userId, now);
    expect(dto.assignments[0]).toMatchObject({ status: 'DEFERRED', answeredAt: null, result: null });
    expect(dto.available).toEqual([]);
    expect(dto.stats).toMatchObject({ assigned: 1, answered: 0, incorrect: 0, inWindowCorrect: 0 });
    expect(dto.copy.retention).toContain('다음 학습일');
  });

  it('includes a hint at local midnight in the deferral day', async () => {
    fixture('RETENTION', 'HINT', new Date('2026-10-13T15:00:00Z'));
    await expect(createAssessmentSession(userId, { kind: 'RETENTION' }, now)).rejects.toMatchObject({ status: 409 });
  });

  it('retires a mixed contaminated assessment before rebuilding its clean allocation', async () => {
    const { tx } = fixture('RETENTION');
    let active = true;
    const clean = { id: 'old-clean', sessionId: 'old', sentenceId: 's1', sentenceVersionId: 'v1', form: 'RECALL', estimatedSeconds: 30, exposures: [], assessments: [{ kind: 'RETENTION_7' }] };
    const dirty = { ...clean, id: 'old-dirty', sentenceId: 'dirty-sentence' };
    tx.exposureEvent.findMany.mockResolvedValue([{ item: { sentenceId: 'dirty-sentence' } }]);
    tx.studySession.findMany.mockImplementation(async () => active ? [{ id: 'old', purpose: 'ASSESSMENT', items: [dirty, clean] }] : []);
    const retire = vi.fn(async () => { active = false; return {}; });
    Object.assign(tx.studySession, { update: retire });
    tx.sessionItem.findMany.mockImplementation(async () => active ? [clean] : []);
    tx.studySession.create.mockImplementation(async () => ({ id: 'new', items: [{ ...clean, id: 'new-clean', sessionId: 'new' }] }) as never);
    expect(await createAssessmentSession(userId, { kind: 'RETENTION' }, now)).toEqual({ id: 'new' });
    expect(retire).toHaveBeenCalledWith({ where: { id: 'old' }, data: { status: 'ABANDONED' } });
    expect(tx.assessmentAssignment.updateMany).toHaveBeenCalledWith({ where: { answeredAt: null, sessionItemId: { in: ['old-dirty', 'old-clean'] } }, data: { sessionItemId: null } });
    expect(tx.assessmentAssignment.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { sessionItemId: 'new-clean' } });
    expect(retire.mock.invocationCallOrder[0]).toBeLessThan(tx.studySession.create.mock.invocationCallOrder[0]!);
    expect(tx.studySession.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ items: { create: [expect.objectContaining({ sentenceId: 's1', estimatedSeconds: 30 })] } }) }));
  });
});
