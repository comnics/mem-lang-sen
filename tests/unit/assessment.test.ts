import { describe, expect, it } from 'vitest';
import { assessmentResult, deterministicSample, isInAssessmentWindow, retentionWindows, weeklyWindow } from '@/domain/assessment';

describe('assessment domain', () => {
  it('creates 7-day and 30-day retention windows around the first recall attempt', () => {
    const startedAt = new Date('2026-10-14T09:00:00.000Z');

    expect(retentionWindows(startedAt).map((window) => ({
      kind: window.kind,
      opensAt: window.opensAt.toISOString(),
      dueAt: window.dueAt.toISOString(),
      closesAt: window.closesAt.toISOString(),
    }))).toEqual([
      {
        kind: 'RETENTION_7',
        opensAt: '2026-10-19T09:00:00.000Z',
        dueAt: '2026-10-21T09:00:00.000Z',
        closesAt: '2026-10-23T09:00:00.000Z',
      },
      {
        kind: 'RETENTION_30',
        opensAt: '2026-11-10T09:00:00.000Z',
        dueAt: '2026-11-13T09:00:00.000Z',
        closesAt: '2026-11-16T09:00:00.000Z',
      },
    ]);
  });

  it('uses a stable Monday-based weekly assessment period', () => {
    const window = weeklyWindow(new Date('2026-10-14T12:00:00.000Z'));

    expect(window).toMatchObject({
      kind: 'WEEKLY',
      periodKey: 'week:2026-10-12',
    });
    expect(window.opensAt.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(window.closesAt.toISOString()).toBe('2026-10-18T23:59:59.999Z');
  });

  it('uses the learner local calendar for weekly assessment periods when a timezone is supplied', () => {
    const window = weeklyWindow(new Date('2026-10-12T06:30:00.000Z'), 'America/Los_Angeles');

    expect(window).toMatchObject({
      kind: 'WEEKLY',
      periodKey: 'week:2026-10-05',
    });
    expect(window.opensAt.toISOString()).toBe('2026-10-05T07:00:00.000Z');
    expect(window.closesAt.toISOString()).toBe('2026-10-12T06:59:59.999Z');
  });

  it('classifies only unassisted correct review results as assessment correct', () => {
    expect(assessmentResult('CORRECT')).toBe('CORRECT');
    expect(assessmentResult('ASSISTED')).toBe('INCORRECT');
    expect(assessmentResult('INCORRECT')).toBe('INCORRECT');
  });

  it('checks inclusive assessment windows', () => {
    const opensAt = new Date('2026-10-14T00:00:00.000Z');
    const closesAt = new Date('2026-10-15T00:00:00.000Z');

    expect(isInAssessmentWindow(opensAt, opensAt, closesAt)).toBe(true);
    expect(isInAssessmentWindow(closesAt, opensAt, closesAt)).toBe(true);
    expect(isInAssessmentWindow(new Date('2026-10-15T00:00:00.001Z'), opensAt, closesAt)).toBe(false);
  });

  it('samples deterministically from a seeded set', () => {
    const items = ['a', 'b', 'c', 'd'];

    expect(deterministicSample(items, 2, (item) => `user:week:${item}`)).toEqual(
      deterministicSample([...items].reverse(), 2, (item) => `user:week:${item}`),
    );
  });
});
