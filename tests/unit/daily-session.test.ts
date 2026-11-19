import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { isDailySessionUsable } from '@/server/services/daily-session';

const now = new Date('2026-11-19T09:00:00Z');
function fixture(available = true) {
  const tx = {
    studyPlan: { findUnique: vi.fn(async () => ({ paused: false, timezone: 'UTC' })) },
    setSentence: { findMany: vi.fn(async () => available ? [{ sentenceVersion: { sentenceId: 'hidden-sentence' } }] : []) },
    userSentencePreference: { count: vi.fn(async () => 1) },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}

describe('today-only hidden preference at the session guard', () => {
  it('does not query hidden preferences for PRACTICE', async () => {
    const { tx, client } = fixture();
    await expect(isDailySessionUsable(client, 'user', { purpose: 'PRACTICE', studyDate: null, timezone: 'UTC' }, ['hidden-sentence'], now)).resolves.toBe(true);
    expect(tx.userSentencePreference.count).not.toHaveBeenCalled();
    // Access is still checked: own ACTIVE personal / PUBLISHED public content,
    // unarchived sentences and non-paused personal enrollment.
    expect(tx.setSentence.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      sentenceVersion: expect.objectContaining({ sentence: { archivedAt: null, OR: [{ scope: 'PUBLIC' }, { scope: 'PERSONAL', ownerId: 'user' }] } }),
      set: { AND: [
        { OR: [{ scope: 'PUBLIC', status: 'PUBLISHED' }, { scope: 'PERSONAL', ownerId: 'user', status: 'ACTIVE' }] },
        { enrollments: { some: { userId: 'user' } } },
        { OR: [{ scope: 'PUBLIC' }, { enrollments: { some: { userId: 'user', paused: false } } }] },
      ] },
    }) }));
  });

  it('still rejects PRACTICE when no accessible membership remains', async () => {
    const { client } = fixture(false);
    await expect(isDailySessionUsable(client, 'user', { purpose: 'PRACTICE', studyDate: null, timezone: 'UTC' }, ['hidden-sentence'], now)).resolves.toBe(false);
  });

  it.each(['DAILY', 'ASSESSMENT'])('still rejects hidden sentences in %s', async (purpose) => {
    const { tx, client } = fixture();
    await expect(isDailySessionUsable(client, 'user', { purpose, studyDate: '2026-11-19', timezone: 'UTC' }, ['hidden-sentence'], now)).resolves.toBe(false);
    expect(tx.userSentencePreference.count).toHaveBeenCalledWith({ where: { userId: 'user', hidden: true, sentenceId: { in: ['hidden-sentence'] } } });
  });
});
