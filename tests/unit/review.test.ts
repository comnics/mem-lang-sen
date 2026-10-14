import { describe, expect, it } from 'vitest';
import { computeReview, REVIEW_INTERVAL_DAYS, REVIEW_POLICY_VERSION, type PreviousReviewState } from '@/domain/review';

const baseNow = new Date('2026-10-14T00:00:00.000Z');

function daysFrom(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function previous(overrides: Partial<PreviousReviewState> = {}): PreviousReviewState {
  return {
    reviewStep: 1,
    dueAt: baseNow,
    qualifiedRecallCount: 2,
    lastQualifiedAt: new Date('2026-10-10T00:00:00.000Z'),
    ...overrides,
  };
}

describe('computeReview', () => {
  it('exports the relative v1 policy contract', () => {
    expect(REVIEW_POLICY_VERSION).toBe('relative-v1');
    expect(REVIEW_INTERVAL_DAYS).toEqual([1, 3, 7, 14, 30]);
  });

  it('schedules first written unassisted success after one 24-hour day without qualifying it', () => {
    const result = computeReview({
      now: baseNow,
      mode: 'WRITTEN',
      result: 'CORRECT',
      previous: null,
      lastExposureAt: null,
    });

    expect(result).toMatchObject({
      reviewStep: 0,
      qualified: false,
      qualifiedRecallCount: 0,
      lastQualifiedAt: null,
      reason: 'written-first-success',
    });
    expect(result.dueAt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
  });

  it('advances a due written success by one stage and counts a qualified recall', () => {
    const result = computeReview({
      now: baseNow,
      mode: 'WRITTEN',
      result: 'CORRECT',
      previous: previous({ reviewStep: 1 }),
      lastExposureAt: daysFrom(baseNow, -2),
    });

    expect(result.reviewStep).toBe(2);
    expect(result.dueAt.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(result.qualified).toBe(true);
    expect(result.qualifiedRecallCount).toBe(3);
    expect(result.lastQualifiedAt?.toISOString()).toBe(baseNow.toISOString());
  });

  it('keeps the current stage for hard due written success while still qualifying', () => {
    const result = computeReview({
      now: baseNow,
      mode: 'WRITTEN',
      result: 'CORRECT',
      hard: true,
      previous: previous({ reviewStep: 2 }),
      lastExposureAt: daysFrom(baseNow, -2),
    });

    expect(result.reviewStep).toBe(2);
    expect(result.dueAt.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(result.qualified).toBe(true);
    expect(result.reason).toBe('written-qualified-hard');
  });

  it('does not advance early written success and keeps the future due date', () => {
    const futureDue = daysFrom(baseNow, 2);
    const result = computeReview({
      now: baseNow,
      mode: 'WRITTEN',
      result: 'CORRECT',
      previous: previous({ reviewStep: 2, dueAt: futureDue }),
      lastExposureAt: daysFrom(baseNow, -2),
    });

    expect(result.reviewStep).toBe(2);
    expect(result.dueAt.toISOString()).toBe(futureDue.toISOString());
    expect(result.qualified).toBe(false);
    expect(result.qualifiedRecallCount).toBe(2);
  });

  it('does not advance written success within 24 hours of the latest exposure', () => {
    const result = computeReview({
      now: baseNow,
      mode: 'WRITTEN',
      result: 'CORRECT',
      previous: previous({ reviewStep: 2, dueAt: daysFrom(baseNow, -1) }),
      lastExposureAt: new Date('2026-10-13T12:30:00.000Z'),
    });

    expect(result.reviewStep).toBe(2);
    expect(result.dueAt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('written-recent-exposure');
  });

  it('resets failed or assisted written attempts while preserving historical qualified counts', () => {
    for (const attempt of ['INCORRECT', 'ASSISTED', 'SELF_REPORTED'] as const) {
      const result = computeReview({
        now: baseNow,
        mode: 'WRITTEN',
        result: attempt,
        previous: previous({ reviewStep: 3 }),
        lastExposureAt: null,
      });

      expect(result.reviewStep).toBe(0);
      expect(result.dueAt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
      expect(result.qualifiedRecallCount).toBe(2);
      expect(result.lastQualifiedAt?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    }
  });

  it('keeps spoken schedule independent and never marks recalls as qualified', () => {
    const good = computeReview({
      now: baseNow,
      mode: 'SPOKEN',
      result: 'SELF_REPORTED',
      selfRating: 'GOOD',
      previous: previous({ reviewStep: 1, qualifiedRecallCount: 7 }),
      lastExposureAt: new Date('2026-10-14T00:00:00.000Z'),
    });
    const again = computeReview({
      now: baseNow,
      mode: 'SPOKEN',
      result: 'SELF_REPORTED',
      selfRating: 'AGAIN',
      previous: previous({ reviewStep: 3, qualifiedRecallCount: 7 }),
      lastExposureAt: null,
    });

    expect(good.reviewStep).toBe(2);
    expect(good.qualified).toBe(false);
    expect(good.qualifiedRecallCount).toBe(7);
    expect(again.reviewStep).toBe(0);
    expect(again.dueAt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(again.qualified).toBe(false);
  });

  it('caps stage advancement at the last interval', () => {
    const result = computeReview({
      now: baseNow,
      mode: 'WRITTEN',
      result: 'CORRECT',
      previous: previous({ reviewStep: 4 }),
      lastExposureAt: daysFrom(baseNow, -2),
    });

    expect(result.reviewStep).toBe(4);
    expect(result.dueAt.toISOString()).toBe('2026-11-13T00:00:00.000Z');
  });
});
