import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), transaction: vi.fn() }));
vi.mock('@/server/db', () => ({ db: { applicationQuestion: { findMany: mocks.findMany }, $transaction: mocks.transaction } }));
import { adminListApplicationQuestions, adminUpdateApplicationQuestion } from '@/server/services/application-questions';

beforeEach(() => vi.resetAllMocks());
describe('public application-question status boundary', () => {
  it.each(['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED'])('preserves supported %s DTOs and PUBLIC filtering', async (status) => {
    mocks.findMany.mockResolvedValue([{ id: 'question', status }]);
    await expect(adminListApplicationQuestions()).resolves.toEqual([{ id: 'question', status }]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sentenceVersion: { sentence: { scope: 'PUBLIC' } } } }));
  });
  it('rejects ACTIVE instead of casting it into the public DTO', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'question', status: 'ACTIVE' }]);
    await expect(adminListApplicationQuestions()).rejects.toThrow();
  });
  it('validates locked status at runtime before writing transitions', async () => {
    const tx = { $queryRaw: vi.fn(async () => [{ id: 'question', status: 'ACTIVE' }]), applicationQuestion: { update: vi.fn() } };
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    await expect(adminUpdateApplicationQuestion('question', { status: 'ARCHIVED' })).rejects.toThrow();
    expect(tx.applicationQuestion.update).not.toHaveBeenCalled();
  });
});
