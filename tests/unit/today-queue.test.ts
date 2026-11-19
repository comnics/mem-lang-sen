import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateTodayQueue } from '@/domain/today-queue';
import { queueCases, queueInput } from './fixtures/today-queue-inputs';
import baseline from './fixtures/today-queue-baseline.json';

// Captured by executing the unextracted buildQueue at e9395af557808ccef2462120325ee7e0b3bffa7b
// through its database boundary. Dates are serialized only for comparison; the
// production persistence payload must continue to contain actual Date objects.
const historical = baseline as Record<string, unknown>;

afterEach(() => vi.useRealTimers());

describe('deterministic today queue characterization', () => {
  it.each(queueCases)('preserves the complete historical three-part output: %s', (name, configure) => {
    const input = queueInput(); configure(input);
    if (name === 'default plan') input.plan.displayName = '';
    const before = structuredClone(input);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
    const result = calculateTodayQueue(input);
    expect(JSON.parse(JSON.stringify(result))).toEqual(historical[name]);
    expect(input).toEqual(before);
    expect(calculateTodayQueue(input)).toEqual(result);
    for (const item of result.selected) {
      expect(item.scheduledAt).toBeInstanceOf(Date);
      if (item.dueAt) expect(item.dueAt).toBeInstanceOf(Date);
    }
  });

  it('keeps review-first ties, first-enrollment version and pre-selection allowance explicit', () => {
    const result = calculateTodayQueue(queueInput());
    expect(result.selected.map((item) => item.sentenceId)).toEqual(['a', 'b', 'new', 'last']);
    expect(result.selected[0]).toMatchObject({ versionId: 'v-a', setTitle: 'First', estimatedSeconds: 30 });
    expect(result.selected[2]!.estimatedSeconds).toBe(60);
    expect(result.dto.remainingSeconds).toBe(300);
    expect(result.selected[0]!.dueAt!.toISOString()).toBe('2026-10-12T01:00:00.000Z');
    expect(result.selected[0]!.scheduledAt!.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(result.dto.calendar).toHaveLength(14);
    expect(result.dto.calendar[0]).toEqual({ date: '2026-10-14', available: true, reviewCount: 2, completedCount: 0 });
    expect(result.dto.calendar[13]!.date).toBe('2026-10-27');
  });
});
