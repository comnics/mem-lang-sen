import { addCalendarDays, dateStart, localDate } from './scheduling';

export const RETENTION_WINDOWS = {
  RETENTION_7: { days: 7, flexDays: 2 },
  RETENTION_30: { days: 30, flexDays: 3 },
} as const;

export const WEEKLY_RECALL_LIMIT = 5;
export const WEEKLY_APPLICATION_LIMIT = 2;
export const ASSESSMENT_ITEM_LIMIT = 10;

export type AssessmentKind = 'RETENTION_7' | 'RETENTION_30' | 'WEEKLY';
export type AssessmentSessionKind = 'RETENTION' | 'WEEKLY';
export type AssessmentForm = 'RECALL' | 'APPLICATION';
export type AssessmentResult = 'CORRECT' | 'INCORRECT';

export type AssessmentWindow = {
  kind: AssessmentKind;
  periodKey: string;
  opensAt: Date;
  dueAt: Date;
  closesAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function retentionWindows(startedAt: Date): AssessmentWindow[] {
  return (Object.entries(RETENTION_WINDOWS) as [keyof typeof RETENTION_WINDOWS, { days: number; flexDays: number }][])
    .map(([kind, rule]) => ({
      kind,
      periodKey: `${kind}:${utcDateKey(startedAt)}`,
      opensAt: addDays(startedAt, rule.days - rule.flexDays),
      dueAt: addDays(startedAt, rule.days),
      closesAt: addDays(startedAt, rule.days + rule.flexDays),
    }));
}

export const assessmentWindows = retentionWindows;

export function weeklyWindow(now: Date, timeZone = 'UTC'): AssessmentWindow {
  if (timeZone === 'UTC') {
    const opensAt = weekStartUtc(now);
    const closesAt = new Date(opensAt.getTime() + WEEK_MS - 1);
    return {
      kind: 'WEEKLY',
      periodKey: weekPeriodKey(opensAt),
      opensAt,
      dueAt: new Date(opensAt.getTime() + 6 * DAY_MS),
      closesAt,
    };
  }

  const today = localDate(now, timeZone);
  const opensOn = addCalendarDays(today, -weekday(today) + 1);
  const closesOn = addCalendarDays(opensOn, 7);
  return {
    kind: 'WEEKLY',
    periodKey: `week:${opensOn}`,
    opensAt: dateStart(opensOn, timeZone),
    dueAt: dateStart(addCalendarDays(opensOn, 6), timeZone),
    closesAt: new Date(dateStart(closesOn, timeZone).getTime() - 1),
  };
}

export function assessmentResult(reviewResult: string): AssessmentResult {
  return reviewResult === 'CORRECT' ? 'CORRECT' : 'INCORRECT';
}

export function isInAssessmentWindow(performedAt: Date, opensAt: Date, closesAt: Date): boolean {
  return performedAt.getTime() >= opensAt.getTime() && performedAt.getTime() <= closesAt.getTime();
}

export function deterministicSample<T>(items: T[], limit: number, seedOf: (item: T) => string): T[] {
  return [...items]
    .sort((left, right) => {
      const order = hashSeed(seedOf(left)).localeCompare(hashSeed(seedOf(right)));
      return order || seedOf(left).localeCompare(seedOf(right));
    })
    .slice(0, limit);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function weekPeriodKey(date: Date): string {
  return `week:${utcDateKey(weekStartUtc(date))}`;
}

function weekStartUtc(date: Date): Date {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = new Date(midnight).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return new Date(midnight + mondayOffset * DAY_MS);
}

function weekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

function hashSeed(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
