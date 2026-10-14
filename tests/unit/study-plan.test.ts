import { describe, expect, it } from 'vitest';
import { completeStudyPlanSchema } from '@/domain/study-plan';
import { defaultSchedule } from '@/domain/scheduling';
const plan = { ...defaultSchedule(new Date('2026-10-14T00:00:00Z')), displayName: '학습자', dailyMinutes: 5 };

describe('study plan boundary validation', () => {
  it('rejects impossible dates, invalid timezones and duplicate exception dates', () => {
    expect(completeStudyPlanSchema.safeParse({ ...plan, startDate: '2026-02-30' }).success).toBe(false);
    expect(completeStudyPlanSchema.safeParse({ ...plan, timezone: 'Not/AZone' }).success).toBe(false);
    expect(completeStudyPlanSchema.safeParse({ ...plan, exceptions: [{ date: '2026-10-15', kind: 'ADD' }, { date: '2026-10-15', kind: 'SKIP' }] }).success).toBe(false);
  });
  it('requires weekdays for weekly schedules but permits interval-only plans', () => {
    expect(completeStudyPlanSchema.safeParse({ ...plan, weekdays: [] }).success).toBe(false);
    expect(completeStudyPlanSchema.safeParse({ ...plan, ruleType: 'INTERVAL', weekdays: [], intervalDays: 2 }).success).toBe(true);
  });
  it('bounds interval, local time and target date without requiring a target', () => {
    expect(completeStudyPlanSchema.safeParse({ ...plan, intervalDays: 31 }).success).toBe(false);
    expect(completeStudyPlanSchema.safeParse({ ...plan, localTime: '24:00' }).success).toBe(false);
    expect(completeStudyPlanSchema.safeParse({ ...plan, targetDate: '2026-10-13' }).success).toBe(false);
    expect(completeStudyPlanSchema.safeParse(plan).success).toBe(true);
  });
});
