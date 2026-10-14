// Evidence badges describe recorded written recall; they are not self ratings.
export type MasteryEvidence = { qualified: boolean; studyDate: string | null; performedAt: Date; exposureGapHours: number | null };
export function masteryEvidence(events: MasteryEvidence[]) {
  const days = new Set<string>();
  let verifiedAt: Date | null = null;
  let maintainedAt: Date | null = null;
  for (const event of [...events].sort((a, b) => a.performedAt.getTime() - b.performedAt.getTime())) {
    if (!event.qualified || !event.studyDate || event.exposureGapHours === null || event.exposureGapHours < 24) continue;
    if (verifiedAt && event.performedAt > verifiedAt && event.exposureGapHours >= 30 * 24) maintainedAt ??= event.performedAt;
    days.add(event.studyDate);
    if (!verifiedAt && days.size >= 3 && event.exposureGapHours >= 7 * 24) verifiedAt = event.performedAt;
  }
  return { verifiedAt, maintainedAt };
}
