import { describe, expect, it } from 'vitest';
import { masteryEvidence } from '@/domain/mastery';
const event = (day: number, gap: number | null, qualified = true) => ({ qualified, studyDate: `2026-10-${String(day).padStart(2, '0')}`, performedAt: new Date(Date.UTC(2026, 9, day)), exposureGapHours: gap });
describe('written evidence badges', () => {
  it('requires three distinct qualified local days and a seven-day exposure gap', () => {
    expect(masteryEvidence([event(1, 24), event(2, 24), event(8, 144)]).verifiedAt).toBeNull();
    expect(masteryEvidence([event(1, 24), event(2, 24), event(9, 168)]).verifiedAt).toEqual(event(9, 168).performedAt);
    expect(masteryEvidence([event(1, 24), event(1, 168), event(9, 168)]).verifiedAt).toBeNull();
  });
  it('requires a later 30-day gap after verified evidence, not a 30-day cohort date', () => {
    const first = [event(1, 24), event(2, 24), event(9, 720)];
    expect(masteryEvidence(first).maintainedAt).toBeNull();
    expect(masteryEvidence([...first, event(31, 24)]).maintainedAt).toBeNull();
    expect(masteryEvidence([...first, event(31, 720)]).maintainedAt).toEqual(event(31, 720).performedAt);
  });
  it('never infers evidence from legacy unknown gaps or self reports', () => {
    expect(masteryEvidence([event(1, null), event(2, 24, false), event(9, 720)]).verifiedAt).toBeNull();
  });
});
