import { describe, expect, it } from 'vitest';
import { parseSentenceCsv } from '@/domain/csv-import';

describe('parseSentenceCsv', () => {
  it('parses quoted commas and pipe-separated accepted answers', () => {
    const csv = [
      'prompt,meaning,target,acceptedAnswers,hint,explanation,level',
      '"카드로 결제할 수 있나요?","Ask, politely","Can I pay by card?","Can I pay by card?|May I pay by card?","Use pay by card","Useful in shops",A1',
    ].join('\n');

    const result = parseSentenceCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toMatchObject([
      {
        row: 2,
        meaning: 'Ask, politely',
        acceptedAnswers: ['Can I pay by card?', 'May I pay by card?'],
        level: 'A1',
      },
    ]);
  });

  it('returns errors and no committed rows for invalid levels', () => {
    const csv = [
      'prompt,meaning,target,acceptedAnswers,hint,explanation,level',
      'p,m,t,a,h,e,C2',
    ].join('\n');

    const result = parseSentenceCsv(csv);

    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.row).toBe(2);
  });
});

describe('CSV boundary validation', () => {
  const header = 'prompt,meaning,target,acceptedAnswers,hint,explanation,level';
  it('rejects empty files and missing headers', () => {
    expect(parseSentenceCsv('').errors).not.toHaveLength(0);
    expect(parseSentenceCsv('wrong\nvalue').errors).not.toHaveLength(0);
  });
  it('bounds batch size to keep imports atomic within a server request', () => {
    expect(parseSentenceCsv([header, ...Array.from({ length: 101 }, () => 'p,m,t,t,h,e,A1')].join('\n')).errors).not.toHaveLength(0);
  });
  it('includes the canonical target in accepted answers', () => {
    expect(parseSentenceCsv(`${header}\np,m,Hello,Hi,h,e,A1`).rows[0].acceptedAnswers).toEqual(['Hello', 'Hi']);
  });
});
