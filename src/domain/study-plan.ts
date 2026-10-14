import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= '1970-01-01' && value <= '2100-12-31';
}, '올바른 날짜를 입력해 주세요.');
const fields = {
  displayName: z.string().trim().min(1).max(80),
  dailyMinutes: z.union([z.literal(3), z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
  timezone: z.string().trim().min(1).max(80).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, '올바른 시간대를 입력해 주세요.'),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).transform((days) => [...new Set(days)].sort()),
};
const schedule = {
  ruleType: z.enum(['WEEKDAYS', 'INTERVAL']),
  intervalDays: z.number().int().min(1).max(30),
  anchorDate: date,
  startDate: date,
  targetDate: date.nullable(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '학습 시간을 확인해 주세요.'),
  paused: z.boolean(),
  exceptions: z.array(z.object({ date, kind: z.enum(['ADD', 'SKIP']) })).max(100).refine((values) => new Set(values.map((value) => value.date)).size === values.length, '같은 날짜의 예외는 하나만 설정해 주세요.'),
};
export const studyPlanInputSchema = z.object(fields).extend(z.object(schedule).partial().shape);
export const completeStudyPlanSchema = z.object({ ...fields, ...schedule }).superRefine((value, context) => {
  if (value.ruleType === 'WEEKDAYS' && value.weekdays.length === 0) context.addIssue({ code: 'custom', path: ['weekdays'], message: '학습 요일을 하나 이상 선택해 주세요.' });
  if (value.targetDate && value.targetDate < value.startDate) context.addIssue({ code: 'custom', path: ['targetDate'], message: '목표일은 시작일 이후로 설정해 주세요.' });
});
export type StudyPlanInput = z.infer<typeof studyPlanInputSchema>;
