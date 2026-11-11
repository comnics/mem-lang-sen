import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/server/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
import { answerSessionItem } from '@/server/services/learning';

const now = new Date('2026-10-14T09:00:00Z');
beforeEach(() => vi.resetAllMocks());

describe('assessment submission rechecks exposure under the user lock', () => {
  it.each(['HINT', 'ANSWER'] as const)('rejects legacy linked %s items before any answer/result writes', async (kind) => {
    const tx = fixture([{ kind }], false);
    await expect(answerSessionItem('user', 'session', { itemId: 'item', eventId: 'event', answer: 'Hello' }, now)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('다음 학습일') });
    expect(tx.reviewEvent.create).not.toHaveBeenCalled();
    expect(tx.userSentenceState.findUnique).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.exposureEvent.findMany.mock.invocationCallOrder[0]!);
  });

  it('rejects a clean item primed in another session after assessment creation', async () => {
    const tx = fixture([], true);
    await expect(answerSessionItem('user', 'session', { itemId: 'item', eventId: 'event', answer: 'Hello' }, now)).rejects.toMatchObject({ status: 409 });
    expect(tx.reviewEvent.create).not.toHaveBeenCalled();
    expect(tx.userSentenceState.findUnique).not.toHaveBeenCalled();
  });

  it('allows clean assessment answers to reach the existing grading path', async () => {
    fixture([], false);
    await expect(answerSessionItem('user', 'session', { itemId: 'item', eventId: 'event', answer: 'Hello' }, now)).rejects.toThrow('grading path reached');
  });
});

function fixture(exposures: { kind: string }[], siblingExposure: boolean) {
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: 'user' }]),
    studyPlan: { findUnique: vi.fn(async () => ({ timezone: 'Asia/Seoul', paused: false })) },
    setSentence: { findMany: vi.fn(async () => [{ sentenceVersion: { sentenceId: 'sentence' } }]) },
    userSentencePreference: { count: vi.fn(async () => 0) },
    userSentenceState: { findUnique: vi.fn(async () => { throw new Error('grading path reached'); }) },
    reviewEvent: { findUnique: vi.fn(async () => null), create: vi.fn() },
    exposureEvent: { findMany: vi.fn(async () => siblingExposure ? [{ item: { sentenceId: 'sentence' } }] : []) },
    sessionItem: { findFirst: vi.fn(async () => ({
      id: 'item', sentenceId: 'sentence', exposures, reviewEvent: null, applicationQuestion: null,
      session: { purpose: 'DAILY', status: 'ACTIVE', mode: 'WRITTEN', timezone: 'Asia/Seoul', studyDate: '2026-10-14' },
      assessments: [{ opensAt: new Date('2026-10-13T09:00:00Z') }],
    })) },
  };
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  return tx;
}
