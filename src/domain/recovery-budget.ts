// A recovery day is shared by daily study and both assessment kinds. The
// persisted date keeps the cap stable once the first answer updates lastEvent.
export function recoveryBudget(
  plan: { dailyMinutes: number; recoveryDate?: string | null },
  lastEvent: { performedAt: Date } | null,
  now: Date,
  studyDate: string,
) {
  const recovery = plan.recoveryDate === studyDate
    || Boolean(lastEvent && now.getTime() - lastEvent.performedAt.getTime() >= 7 * 86_400_000);
  return { recovery, effectiveMinutes: recovery ? Math.min(plan.dailyMinutes, 3) : plan.dailyMinutes };
}
