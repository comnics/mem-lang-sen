import { describe, expect, it } from 'vitest';
import { addCalendarDays, dateStart, defaultSchedule, isStudyDate, localDate, nextStudyAt, type ScheduleRule } from '@/domain/scheduling';

function rule(overrides: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    timezone: 'Asia/Seoul',
    ruleType: 'WEEKDAYS',
    weekdays: [1, 3, 5],
    intervalDays: 2,
    anchorDate: '2026-10-14',
    startDate: '2026-10-14',
    targetDate: null,
    localTime: '09:00',
    paused: false,
    exceptions: [],
    ...overrides,
  };
}

describe('calendar scheduling', () => {
  it('formats local dates at UTC boundaries and adds calendar days', () => {
    expect(localDate(new Date('2026-10-14T14:59:59.000Z'), 'Asia/Seoul')).toBe('2026-10-14');
    expect(localDate(new Date('2026-10-14T15:00:00.000Z'), 'Asia/Seoul')).toBe('2026-10-15');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('matches weekday rules after the start date', () => {
    const schedule = rule({ weekdays: [1, 3, 5], startDate: '2026-10-14' });

    expect(isStudyDate('2026-10-13', schedule)).toBe(false);
    expect(isStudyDate('2026-10-14', schedule)).toBe(true);
    expect(isStudyDate('2026-10-15', schedule)).toBe(false);
    expect(isStudyDate('2026-10-16', schedule)).toBe(true);
  });

  it('matches N-day interval rules from the local calendar anchor', () => {
    const schedule = rule({
      ruleType: 'INTERVAL',
      anchorDate: '2026-10-14',
      intervalDays: 3,
      weekdays: [],
      startDate: '2026-10-15',
    });

    expect(isStudyDate('2026-10-14', schedule)).toBe(false);
    expect(isStudyDate('2026-10-15', schedule)).toBe(false);
    expect(isStudyDate('2026-10-17', schedule)).toBe(true);
    expect(isStudyDate('2026-10-20', schedule)).toBe(true);
  });

  it('applies add and skip exceptions after start, with skip winning duplicates', () => {
    const schedule = rule({
      weekdays: [1],
      exceptions: [
        { date: '2026-10-15', kind: 'ADD' },
        { date: '2026-10-19', kind: 'SKIP' },
        { date: '2026-10-20', kind: 'ADD' },
        { date: '2026-10-20', kind: 'SKIP' },
      ],
    });

    expect(isStudyDate('2026-10-13', { ...schedule, exceptions: [{ date: '2026-10-13', kind: 'ADD' }] })).toBe(false);
    expect(isStudyDate('2026-10-15', schedule)).toBe(true);
    expect(isStudyDate('2026-10-19', schedule)).toBe(false);
    expect(isStudyDate('2026-10-20', schedule)).toBe(false);
  });

  it('does not use targetDate as a cutoff and returns null while paused', () => {
    const schedule = rule({ targetDate: '2026-10-14' });

    expect(isStudyDate('2026-10-16', schedule)).toBe(true);
    expect(nextStudyAt(new Date('2026-10-14T00:00:00.000Z'), { ...schedule, paused: true })).toBeNull();
  });

  it('finds the next local study time at or after notBefore', () => {
    const schedule = rule({ weekdays: [3, 5], localTime: '09:00' });

    expect(nextStudyAt(new Date('2026-10-14T00:00:00.000Z'), schedule)?.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(nextStudyAt(new Date('2026-10-14T00:00:01.000Z'), schedule)?.toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });

  it('uses local calendar interval even across timezone changes', () => {
    const seoul = rule({ ruleType: 'INTERVAL', anchorDate: '2026-10-14', intervalDays: 2, weekdays: [], localTime: '09:00' });
    const losAngeles = { ...seoul, timezone: 'America/Los_Angeles' };

    expect(nextStudyAt(new Date('2026-10-14T00:00:00.000Z'), seoul)?.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(nextStudyAt(new Date('2026-10-14T00:00:00.000Z'), losAngeles)?.toISOString()).toBe('2026-10-14T16:00:00.000Z');
  });

  it('rolls a DST spring gap forward to the next valid minute on the same local date', () => {
    const schedule = rule({
      timezone: 'America/New_York',
      ruleType: 'WEEKDAYS',
      weekdays: [0],
      startDate: '2026-03-08',
      localTime: '02:30',
    });

    expect(nextStudyAt(new Date('2026-03-08T00:00:00.000Z'), schedule)?.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });

  it('chooses the earliest DST fall occurrence that is not before the requested instant', () => {
    const schedule = rule({
      timezone: 'America/New_York',
      ruleType: 'WEEKDAYS',
      weekdays: [0],
      startDate: '2026-11-01',
      localTime: '01:30',
    });

    expect(nextStudyAt(new Date('2026-11-01T00:00:00.000Z'), schedule)?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(nextStudyAt(new Date('2026-11-01T05:45:00.000Z'), schedule)?.toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('finds dateStart through timezone transitions', () => {
    expect(dateStart('2026-10-14', 'Asia/Seoul').toISOString()).toBe('2026-10-13T15:00:00.000Z');
    expect(dateStart('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('builds a conservative default schedule', () => {
    expect(defaultSchedule(new Date('2026-10-14T00:00:00.000Z'))).toMatchObject({
      timezone: 'Asia/Seoul',
      ruleType: 'WEEKDAYS',
      weekdays: [1, 2, 3, 4, 5],
      intervalDays: 2,
      anchorDate: '2026-10-14',
      startDate: '2026-10-14',
      localTime: '09:00',
      paused: false,
    });
  });
});
