import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), db: {} as Record<string, unknown> }));
vi.mock('@/server/db', () => ({ db: mocks.db }));
import { createAssessmentSession } from '@/server/services/assessments';
import { createTodaySession, getTodayQueue } from '@/server/services/scheduling';
import { defaultSchedule } from '@/domain/scheduling';

const now = new Date('2026-10-14T09:00:00Z');
const userId = 'recovery-user';
const versions = Array.from({ length: 12 }, (_, i) => ({
  id: `v${i}`, sentenceId: `s${i}`, prompt: `Prompt ${i}`, meaning: `Meaning ${i}`, applicationQuestions: [],
}));
const assignments = versions.map((version, i) => ({
  id: `a${i}`, kind: 'RETENTION_7', periodKey: `retention:${i}`,
  cohort: { id: `c${i}`, sentenceId: version.sentenceId, baselineVersionId: null },
}));

// Model only the database boundary: both real session services and their budget
// calculations run unchanged. PostgreSQL locking/rollback needs integration tests.
function fixture(lastPerformedAt: Date | null = new Date(now.getTime() - 7 * 86_400_000)) {
  const plan = { ...defaultSchedule(now), displayName: 'Recovery', dailyMinutes: 20, weekdays: [0, 1, 2, 3, 4, 5, 6], localTime: '00:00', recoveryDate: null as string | null };
  const sessions: { id: string; purpose: string; mode: string; studyDate: string; timezone: string; status: string; items: { id: string; estimatedSeconds: number; sentenceId: string }[] }[] = [];
  const dayEvents: { item: { estimatedSeconds: number } }[] = [];
  let lastEvent = lastPerformedAt ? { performedAt: lastPerformedAt } : null;
  let answered = 0;
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: userId }]),
    studyPlan: {
      findUnique: vi.fn(async () => plan),
      updateMany: vi.fn(async ({ data }: { data: { recoveryDate: string } }) => { Object.assign(plan, data); return { count: 1 }; }),
    },
    enrollment: { findMany: vi.fn(async () => [{ createdAt: now, set: { title: 'Set', sentences: versions.map((sentenceVersion) => ({ sentenceVersion })) } }]) },
    userSentenceState: { findMany: vi.fn(async () => []) },
    userSentencePreference: { findMany: vi.fn(async () => []) },
    reviewEvent: {
      findMany: vi.fn(async ({ where }: { where: { performedAt?: unknown } }) => where.performedAt ? dayEvents : []),
      findFirst: vi.fn(async () => lastEvent),
    },
    assessmentCohort: { createMany: vi.fn(async () => ({ count: 0 })) },
    assessmentAssignment: {
      findMany: vi.fn(async () => assignments.slice(answered)),
      update: vi.fn(async () => ({})),
    },
    sessionItem: { findMany: vi.fn(async () => []) },
    studySession: {
      findMany: vi.fn(async ({ where }: { where: { studyDate: string; purpose: string | object } }) => sessions.filter((session) => session.status === 'ACTIVE' && session.studyDate === where.studyDate && (typeof where.purpose !== 'string' || session.purpose === where.purpose)).map((session) => ({ ...session, items: session.items.map((item) => ({ ...item, assessments: [assignments[0]] })) }))),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: { purpose: string; mode: string; studyDate: string; timezone: string; items: { create: { estimatedSeconds: number; sentenceId: string }[] } } }) => {
        const session = { ...data, id: `session${sessions.length}`, status: 'ACTIVE', items: data.items.create.map((item, i) => ({ ...item, id: `item${sessions.length}:${i}` })) };
        sessions.push(session);
        return session;
      }),
    },
  };
  Object.assign(mocks.db, tx, { $transaction: mocks.transaction });
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  return { plan, tx, sessions, submit(count: number) {
    const active = sessions.find((session) => session.status === 'ACTIVE')!;
    const items = active.items.splice(0, count);
    dayEvents.push(...items.map((item) => ({ item })));
    answered += items.length;
    lastEvent = { performedAt: now };
    if (!active.items.length) active.status = 'COMPLETED';
  }, nextDay() { dayEvents.length = 0; } };
}

beforeEach(() => vi.resetAllMocks());

describe('assessment-first recovery day (real services, database double)', () => {
  it('persists the recovery date under the user lock before creating an assessment', async () => {
    const f = fixture();
    await createAssessmentSession(userId, { kind: 'RETENTION' }, now);
    expect(f.plan.recoveryDate).toBe('2026-10-14');
    expect(f.sessions[0]!.items).toHaveLength(6);
    expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.studyPlan.updateMany.mock.invocationCallOrder[0]!);
    expect(f.tx.studyPlan.updateMany.mock.invocationCallOrder[0]).toBeLessThan(f.tx.studySession.create.mock.invocationCallOrder[0]!);
  });

  it('keeps spent plus reserved budget at 180 after partial answers, restart and mode switch', async () => {
    const f = fixture();
    const first = await createAssessmentSession(userId, { kind: 'RETENTION' }, now);
    f.submit(1);
    expect(await createAssessmentSession(userId, { kind: 'RETENTION' }, now)).toEqual(first);
    for (const mode of ['WRITTEN', 'SPOKEN'] as const) {
      expect(await getTodayQueue(userId, mode, now)).toMatchObject({ recovery: true, effectiveMinutes: 3, remainingSeconds: 0 });
      if (mode === 'WRITTEN') await expect(createTodaySession(userId, mode, now)).resolves.toEqual(first);
      else await expect(createTodaySession(userId, mode, now)).rejects.toMatchObject({ status: 409 });
    }
    f.submit(5);
    await expect(createAssessmentSession(userId, { kind: 'RETENTION' }, now)).rejects.toMatchObject({ status: 409 });
    expect(await getTodayQueue(userId, 'WRITTEN', now)).toMatchObject({ recovery: true, remainingSeconds: 0 });
    f.nextDay();
    expect(await getTodayQueue(userId, 'WRITTEN', new Date('2026-10-15T09:00:00Z'))).toMatchObject({ recovery: false, effectiveMinutes: 20, remainingSeconds: 1200 });
  });

  it.each([null, new Date(now.getTime() - 7 * 86_400_000 + 1)])('does not mark a new or recently active user as recovering (%s)', async (lastEvent) => {
    const f = fixture(lastEvent);
    await createAssessmentSession(userId, { kind: 'RETENTION' }, now);
    expect(f.plan.recoveryDate).toBeNull();
    expect(f.tx.studyPlan.updateMany).not.toHaveBeenCalled();
    expect(f.sessions[0]!.items.length).toBeGreaterThan(6);
  });
});
