import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sign: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: mocks.sign }) } }),
}));
vi.mock('@/server/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('@/server/auth', () => ({ requireUser: async () => ({ id: 'user' }) }));

import { answerSessionItem } from '@/server/services/learning';
import { signedAudioUrl } from '@/server/services/content';
import { POST } from '@/app/api/v1/study-sessions/[id]/answers/route';

const input = { itemId: 'cm123456789012345678901234', eventId: 'e21637be-409a-4b01-aabb-1274d3db4147', answer: 'Hello.' };
const expected = {
  correct: true, result: 'CORRECT', target: 'Hello.', acceptedAnswers: ['Hello.'],
  explanation: 'Greeting', nextDueAt: null, qualified: true, reviewStep: 1,
  reviewReason: 'written-first-success', form: 'RECALL', completed: true,
};
let audioAsset: { status: string; path: string } | null;

beforeEach(() => {
  mocks.sign.mockReset().mockResolvedValue({ data: { signedUrl: 'https://audio.test/signed' }, error: null });
  audioAsset = { status: 'READY', path: 'private/answer.wav' };
  // Exercise the public service replay path with a persisted answer; no real database is used.
  mocks.transaction.mockImplementation(async (callback) => callback({
    $queryRaw: async () => [{ id: 'user' }],
    reviewEvent: { findUnique: async () => ({
      ...expected, answer: input.answer, targetSnapshot: expected.target, sessionItemId: input.itemId,
      item: { sessionId: 'session', sentenceVersion: { audioAsset } },
    }) },
    sessionItem: { count: async () => 0 },
  }));
});

const failures = [
  ['returned error', () => mocks.sign.mockResolvedValue({ data: null, error: { message: 'Storage unavailable' } })],
  ['missing URL', () => mocks.sign.mockResolvedValue({ data: {}, error: null })],
  ['thrown failure', () => mocks.sign.mockRejectedValue(new Error('Network failure'))],
] as const;

describe('optional answer audio', () => {
  it.each(failures)('preserves grading and HTTP acknowledgment on %s', async (_name, fail) => {
    fail();
    const result = await answerSessionItem('user', 'session', input);
    expect(result).toEqual({ ...expected, audioUrl: undefined });
    expect(result).not.toHaveProperty('audioPath');
    const response = await POST(new Request('http://localhost/api/v1/study-sessions/session/answers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }), { params: Promise.resolve({ id: 'session' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    // The shared signer must still reject for callers that require audio.
    await expect(signedAudioUrl('private/answer.wav')).rejects.toThrow();
  });

  it('keeps successful signed URLs and strips the internal path', async () => {
    expect(await answerSessionItem('user', 'session', input)).toEqual({ ...expected, audioUrl: 'https://audio.test/signed' });
    expect(mocks.sign).toHaveBeenCalledWith('private/answer.wav', 300);
  });

  it('does not contact Storage when the answer has no audio', async () => {
    audioAsset = null;
    expect(await answerSessionItem('user', 'session', input)).toEqual({ ...expected, audioUrl: undefined });
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
