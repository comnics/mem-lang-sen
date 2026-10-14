import { describe, expect, it } from 'vitest';
import { gradeWrittenAnswer, normalizeAnswer } from '@/domain/grading';

describe('gradeWrittenAnswer', () => {
  it('normalizes case, whitespace, and punctuation before exact accepted-answer matching', () => {
    const result = gradeWrittenAnswer('  could you say that again?! ', ['Could you say that again?']);
    expect(result.correct).toBe(true);
    expect(result.normalizedAnswer).toBe('could you say that again');
  });

  it('does not accept partial answers', () => {
    expect(gradeWrittenAnswer('say that again', ['Could you say that again?']).correct).toBe(false);
  });
});

describe('normalizeAnswer', () => {
  it('uses NFKC normalization for full-width text', () => {
    expect(normalizeAnswer('Ｃａｎ　Ｉ　ｐａｙ　ｂｙ　ｃａｒｄ？')).toBe('can i pay by card');
  });
});
