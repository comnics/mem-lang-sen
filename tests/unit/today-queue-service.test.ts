import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as calculator from '@/domain/today-queue';
import { queueInput } from './fixtures/today-queue-inputs';

const mocks = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock('@/server/db', () => ({ db: mocks.db }));
import { createTodaySession, getTodayQueue } from '@/server/services/scheduling';

function databaseFixture(defaultPlan = false) {
  const input = queueInput();
  input.plan.dailyMinutes = 20;
  input.lastEvent = { performedAt: new Date('2026-10-01T00:00:00Z') };
  input.pendingSessions = [{ id: 'invalid', mode: 'WRITTEN', items: [{ sentenceId: 'gone', estimatedSeconds: 60 }] }];
  let stored = !defaultPlan;
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: 'user' }]),
    appUser: { findUniqueOrThrow: vi.fn(async () => ({ displayName: 'Default' })) },
    studyPlan: {
      findUnique: vi.fn(async () => stored ? input.plan : null),
      create: vi.fn(async ({ data }: { data: object }) => { stored = true; Object.assign(input.plan, data); return input.plan; }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    enrollment: { findMany: vi.fn(async () => input.enrollments) },
    userSentenceState: { findMany: vi.fn(async () => input.states) },
    userSentencePreference: { findMany: vi.fn(async () => input.preferences) },
    reviewEvent: { findMany: vi.fn(async () => input.dayEvents), findFirst: vi.fn(async () => input.lastEvent) },
    studySession: {
      findMany: vi.fn(async () => input.pendingSessions),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({ id: 'created' })),
    },
  };
  const transaction = vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx));
  Object.assign(mocks.db, tx, { $transaction: transaction });
  return { input, tx, transaction };
}

beforeEach(() => vi.restoreAllMocks());

describe('today queue service/calculator boundary (database double)', () => {
  it('passes normalized ordered rows and supplied clock to the real calculator without writes', async () => {
    const { input, tx, transaction } = databaseFixture();
    const spy = vi.spyOn(calculator, 'calculateTodayQueue');
    const dto = await getTodayQueue('user', input.mode, input.now);
    expect(spy).toHaveBeenCalledExactlyOnceWith(input);
    expect(dto).toEqual(spy.mock.results[0]!.value.dto);
    expect(tx.enrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { setId: 'asc' }] }));
    expect(tx.userSentenceState.findMany).toHaveBeenCalledWith({ where: { userId: 'user', mode: 'WRITTEN' } });
    expect(tx.reviewEvent.findMany).toHaveBeenCalledWith({ where: { userId: 'user', performedAt: { gte: new Date('2026-10-13T15:00:00Z'), lt: new Date('2026-10-14T15:00:00Z') } }, include: { item: true } });
    expect(tx.studySession.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user', purpose: { in: ['DAILY', 'ASSESSMENT'] }, status: 'ACTIVE', studyDate: '2026-10-14', timezone: 'Asia/Seoul' } }));
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.studyPlan.create).not.toHaveBeenCalled();
    expect(tx.studyPlan.updateMany).not.toHaveBeenCalled();
    expect(tx.studySession.updateMany).not.toHaveBeenCalled();
    expect(tx.studySession.create).not.toHaveBeenCalled();
  });

  it('normalizes a missing plan without persisting from getTodayQueue', async () => {
    const { input, tx } = databaseFixture(true);
    const spy = vi.spyOn(calculator, 'calculateTodayQueue');
    const dto = await getTodayQueue('user', input.mode, input.now);
    expect(spy).toHaveBeenCalledWith({ ...input, plan: { ...input.plan, displayName: '', dailyMinutes: 5, recoveryDate: undefined } });
    expect(dto.dailyMinutes).toBe(5);
    expect(tx.studyPlan.create).not.toHaveBeenCalled();
  });

  it('keeps default persistence, lock, abandonment, recovery write and item creation order', async () => {
    const { input, tx, transaction } = databaseFixture(true);
    const spy = vi.spyOn(calculator, 'calculateTodayQueue');
    expect(await createTodaySession('user', input.mode, input.now)).toEqual({ id: 'created' });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted', timeout: 20_000 });
    expect(spy).toHaveBeenCalledTimes(1);
    const result = spy.mock.results[0]!.value as calculator.TodayQueueResult;
    expect(tx.studySession.updateMany.mock.calls[0]).toEqual([{ where: { userId: 'user', id: { in: result.invalidSessionIds }, status: 'ACTIVE' }, data: { status: 'ABANDONED' } }]);
    expect(tx.studySession.create).toHaveBeenCalledWith({ data: {
      userId: 'user', mode: 'WRITTEN', purpose: 'DAILY', studyDate: '2026-10-14', timezone: 'Asia/Seoul', createdAt: input.now,
      items: { create: result.selected.map((item, index) => ({ sentenceId: item.sentenceId, sentenceVersionId: item.versionId, prompt: item.prompt, meaning: item.meaning, position: index + 1, dueAt: item.dueAt, scheduledAt: item.scheduledAt, estimatedSeconds: item.estimatedSeconds })) },
    }, select: { id: true } });
    const order = [tx.$queryRaw, tx.studyPlan.create, spy, tx.studySession.updateMany, tx.studyPlan.updateMany, tx.studySession.create].map((fn) => fn.mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(tx.studySession.updateMany.mock.invocationCallOrder[1]).toBeLessThan(tx.studyPlan.updateMany.mock.invocationCallOrder[0]!);
  });

  it('abandons invalid IDs before resuming a valid same-mode session without creating', async () => {
    const { input, tx } = databaseFixture();
    input.pendingSessions.push({ id: 'resume', mode: 'WRITTEN', items: [{ sentenceId: 'a', estimatedSeconds: 30 }] });
    expect(await createTodaySession('user', input.mode, input.now)).toEqual({ id: 'resume' });
    expect(tx.studySession.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { userId: 'user', id: { in: ['invalid'] }, status: 'ACTIVE' }, data: { status: 'ABANDONED' } });
    expect(tx.studySession.create).not.toHaveBeenCalled();
    expect(tx.studyPlan.updateMany).not.toHaveBeenCalled();
  });
});
