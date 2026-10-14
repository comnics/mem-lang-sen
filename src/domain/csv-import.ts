import { parse } from 'csv-parse/sync';
import { z } from 'zod';

export type ImportRow = {
  row: number;
  prompt: string;
  meaning: string;
  target: string;
  acceptedAnswers: string[];
  hint: string;
  explanation: string;
  level: 'A1' | 'A2' | 'B1';
};

export type ImportError = {
  row: number;
  message: string;
};

const requiredColumns = ['prompt', 'meaning', 'target', 'acceptedAnswers', 'hint', 'explanation', 'level'] as const;

const rowSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  meaning: z.string().trim().min(1).max(500),
  target: z.string().trim().min(1).max(500),
  acceptedAnswers: z.string().trim().min(1).max(6012),
  hint: z.string().trim().min(1).max(500),
  explanation: z.string().trim().min(1).max(1000),
  level: z.enum(['A1', 'A2', 'B1']),
});

export function parseSentenceCsv(csv: string): { rows: ImportRow[]; errors: ImportError[] } {
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      bom: true,
      columns: (headers: string[]) => {
        if (headers.length !== requiredColumns.length || requiredColumns.some((name) => !headers.includes(name)) || new Set(headers).size !== headers.length) throw new Error('필수 CSV 헤더를 중복 없이 입력해 주세요.');
        return headers;
      },
      skip_empty_lines: true,
      trim: true,
    });
  } catch (error) {
    return { rows: [], errors: [{ row: 1, message: error instanceof Error ? error.message : 'CSV 형식을 확인해 주세요.' }] };
  }

  if (records.length === 0 || records.length > 100) return { rows: [], errors: [{ row: 1, message: '한 번에 1~100개 문장을 가져올 수 있습니다.' }] };
  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  records.forEach((record, index) => {
    const rowNumber = index + 2;
    for (const column of requiredColumns) {
      if (!(column in record)) {
        errors.push({ row: rowNumber, message: `${column} 컬럼이 필요합니다.` });
        return;
      }
    }

    const parsed = rowSchema.safeParse(record);
    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        message: parsed.error.issues[0]?.message ?? '행 값을 확인해 주세요.',
      });
      return;
    }

    const acceptedAnswers = parsed.data.acceptedAnswers
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean);

    if (acceptedAnswers.length === 0 || acceptedAnswers.length > 12 || acceptedAnswers.some((answer) => answer.length > 500)) {
      errors.push({ row: rowNumber, message: '허용 답안은 1~12개, 각 500자 이하로 입력해 주세요.' });
      return;
    }

    rows.push({
      row: rowNumber,
      ...parsed.data,
      acceptedAnswers: [...new Set([parsed.data.target, ...acceptedAnswers])],
    });
  });

  return { rows, errors };
}
