export type ScheduleRule = {
  timezone: string;
  ruleType: 'WEEKDAYS' | 'INTERVAL';
  weekdays: number[];
  intervalDays: number;
  anchorDate: string;
  startDate: string;
  targetDate: string | null;
  localTime: string;
  paused: boolean;
  exceptions: { date: string; kind: 'ADD' | 'SKIP' }[];
};

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_SEARCH_DAYS = 400;

export function localDate(date: Date, timeZone: string): string {
  const parts = getLocalParts(date, timeZone);
  return formatDate(parts.year, parts.month, parts.day);
}

export function addCalendarDays(date: string, days: number): string {
  assertDateString(date);
  const [year, month, day] = parseDate(date);
  const utc = Date.UTC(year, month - 1, day + Math.trunc(days));
  const result = new Date(utc);
  return formatDate(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
}

export function isStudyDate(date: string, rule: ScheduleRule): boolean {
  validateRule(rule);
  assertDateString(date);
  if (date < rule.startDate) return false;

  const exceptions = rule.exceptions.filter((exception) => exception.date === date);
  if (exceptions.some((exception) => exception.kind === 'SKIP')) return false;
  if (exceptions.some((exception) => exception.kind === 'ADD')) return true;

  if (rule.ruleType === 'WEEKDAYS') return rule.weekdays.includes(weekday(date));

  const distance = calendarDayDistance(rule.anchorDate, date);
  return distance >= 0 && distance % rule.intervalDays === 0;
}

export function nextStudyAt(notBefore: Date, rule: ScheduleRule): Date | null {
  validateRule(rule);
  if (rule.paused) return null;

  const start = maxDate(localDate(notBefore, rule.timezone), rule.startDate);
  const [hour, minute] = parseTime(rule.localTime);

  for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset += 1) {
    const date = addCalendarDays(start, offset);
    if (!isStudyDate(date, rule)) continue;

    const instant = firstInstantAtOrAfter(date, hour, minute, rule.timezone, notBefore);
    if (instant) return instant;
  }

  return null;
}

export function dateStart(date: string, timeZone: string): Date {
  assertDateString(date);
  return firstValidLocalMinute(date, 0, 0, timeZone) ?? failNoInstant(date, timeZone);
}

export function defaultSchedule(now: Date): ScheduleRule {
  const timezone = 'Asia/Seoul';
  const today = localDate(now, timezone);
  return {
    timezone,
    ruleType: 'WEEKDAYS',
    weekdays: [1, 2, 3, 4, 5],
    intervalDays: 2,
    anchorDate: today,
    startDate: today,
    targetDate: null,
    localTime: '09:00',
    paused: false,
    exceptions: [],
  };
}

function firstInstantAtOrAfter(date: string, hour: number, minute: number, timeZone: string, notBefore: Date): Date | null {
  const startMinute = hour * 60 + minute;
  const scheduledCandidates = possibleInstantsForLocal(date, hour, minute, timeZone);
  if (scheduledCandidates.length) {
    return scheduledCandidates.find((candidate) => candidate.getTime() >= notBefore.getTime()) ?? null;
  }

  for (let localMinute = startMinute + 1; localMinute < 24 * 60; localMinute += 1) {
    const rolledCandidates = possibleInstantsForLocal(date, Math.floor(localMinute / 60), localMinute % 60, timeZone);
    const match = rolledCandidates.find((candidate) => candidate.getTime() >= notBefore.getTime());
    if (match) return match;
  }
  return null;
}

function firstValidLocalMinute(date: string, hour: number, minute: number, timeZone: string): Date | null {
  const startMinute = hour * 60 + minute;
  for (let localMinute = startMinute; localMinute < 24 * 60; localMinute += 1) {
    const candidates = possibleInstantsForLocal(date, Math.floor(localMinute / 60), localMinute % 60, timeZone);
    if (candidates.length) return candidates[0] ?? null;
  }
  return null;
}

function possibleInstantsForLocal(date: string, hour: number, minute: number, timeZone: string): Date[] {
  const [year, month, day] = parseDate(date);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offsets = new Set<number>();

  for (let deltaHours = -36; deltaHours <= 36; deltaHours += 1) {
    offsets.add(getOffsetMs(new Date(targetUtc + deltaHours * 60 * 60 * 1000), timeZone));
  }

  const candidates = [...offsets]
    .map((offset) => new Date(targetUtc - offset))
    .filter((candidate) => localPartsEqual(getLocalParts(candidate, timeZone), { year, month, day, hour, minute, second: 0 }))
    .sort((a, b) => a.getTime() - b.getTime());

  return [...new Map(candidates.map((candidate) => [candidate.getTime(), candidate])).values()];
}

function getOffsetMs(date: Date, timeZone: string): number {
  const parts = getLocalParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return localAsUtc - date.getTime();
}

function getLocalParts(date: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: requiredPart(values, 'year'),
    month: requiredPart(values, 'month'),
    day: requiredPart(values, 'day'),
    hour: requiredPart(values, 'hour'),
    minute: requiredPart(values, 'minute'),
    second: requiredPart(values, 'second'),
  };
}

function validateRule(rule: ScheduleRule): void {
  new Intl.DateTimeFormat('en-US', { timeZone: rule.timezone }).format(new Date(0));
  assertDateString(rule.anchorDate);
  assertDateString(rule.startDate);
  if (rule.targetDate !== null) assertDateString(rule.targetDate);
  parseTime(rule.localTime);
  if (!Number.isInteger(rule.intervalDays) || rule.intervalDays < 1 || rule.intervalDays > 30) {
    throw new RangeError('intervalDays must be between 1 and 30');
  }
  if (rule.exceptions.length > 100) throw new RangeError('exceptions must not exceed 100');
  if (rule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new RangeError('weekdays must use 0..6');
  }
  for (const exception of rule.exceptions) assertDateString(exception.date);
}

function parseDate(date: string): [number, number, number] {
  assertDateString(date);
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

function assertDateString(date: string): void {
  if (!DATE_RE.test(date)) throw new RangeError(`Invalid date: ${date}`);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new RangeError(`Invalid date: ${date}`);
  }
}

function parseTime(time: string): [number, number] {
  const match = TIME_RE.exec(time);
  if (!match) throw new RangeError(`Invalid localTime: ${time}`);
  return [Number(match[1]), Number(match[2])];
}

function weekday(date: string): number {
  const [year, month, day] = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function calendarDayDistance(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = parseDate(from);
  const [toYear, toMonth, toDay] = parseDate(to);
  return Math.trunc((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / DAY_MS);
}

function localPartsEqual(left: LocalParts, right: LocalParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function formatDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function requiredPart(parts: Map<string, string>, name: string): number {
  const value = parts.get(name);
  if (!value) throw new RangeError(`Missing Intl part: ${name}`);
  return Number(value);
}

function maxDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function failNoInstant(date: string, timeZone: string): never {
  throw new RangeError(`No valid local instant for ${date} in ${timeZone}`);
}
