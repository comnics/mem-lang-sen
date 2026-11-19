import { z } from 'zod';

export const normalizePersonalText = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ');
const text = (max: number) => z.string().transform(normalizePersonalText).pipe(z.string().max(max));
export const personalSentenceSchema = z.object({
  prompt: text(500).pipe(z.string().min(1, '한국어 질문/상황을 입력해 주세요.')),
  target: text(500).pipe(z.string().min(1, '영어 정답을 입력해 주세요.')),
  meaning: text(500).default(''),
  hint: text(500).default(''),
  explanation: text(1000).default(''),
  acceptedAnswers: z.array(text(500).pipe(z.string().min(1))).max(100).default([]),
  language: z.literal('en').default('en'),
  level: z.enum(['A1', 'A2', 'B1']).default('A1'),
}).strict().transform((row) => ({ ...row, acceptedAnswers: [...new Set([row.target, ...row.acceptedAnswers])] }))
  .refine((row) => row.acceptedAnswers.length <= 12, '정답을 포함한 허용 답안은 최대 12개입니다.');
export type PersonalSentenceInput = z.input<typeof personalSentenceSchema>;
export type PersonalSentenceValue = z.output<typeof personalSentenceSchema>;
export const personalSetSchema = z.object({
  title: text(120).pipe(z.string().min(1)), description: text(500).default(''),
  category: z.enum(['SITUATION', 'PATTERN', 'FUNCTION']).default('SITUATION'),
  level: z.enum(['A1', 'A2', 'B1']).default('A1'),
}).strict();
export const personalRowSchema = z.object({
  row: z.number().int().min(1).max(100000),
  prompt: z.string().max(4000).default(''), target: z.string().max(4000).default(''),
  meaning: z.string().max(4000).default(''), hint: z.string().max(4000).default(''),
  explanation: z.string().max(4000).default(''), acceptedAnswers: z.array(z.string().max(4000)).max(100).default([]),
  level: z.string().max(20).default('A1'),
}).strict();
export type PersonalRow = z.output<typeof personalRowSchema>;
export type PersonalRowError = { row: number; field: string; message: string };
export const personalRowsSchema = z.array(personalRowSchema).min(1).max(100).refine(rows => new Set(rows.map(row => row.row)).size === rows.length, '행 번호가 중복되었습니다.');
export function personalDuplicateKey(row: { prompt: string; target: string }) {
  return JSON.stringify([normalizePersonalText(row.prompt), normalizePersonalText(row.target)]);
}
export function validatePersonalRows(rows: PersonalRow[]) {
  const errors: PersonalRowError[] = [];
  const normalized = rows.map((row) => {
    const { row: position, ...value } = row;
    const parsed = personalSentenceSchema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push({ row: position, field: String(issue.path[0] ?? 'acceptedAnswers'), message: issue.message });
      return row;
    }
    const { language: _language, ...data } = parsed.data;
    void _language;
    return { row: position, ...data };
  });
  return { rows: normalized, errors };
}
