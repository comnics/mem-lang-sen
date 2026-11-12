import type { StudyMode, StudyPlanValue, TodayQueueDTO } from '@/domain/m4-types';
import { addCalendarDays, dateStart, isStudyDate, localDate, nextStudyAt } from '@/domain/scheduling';
import { recoveryBudget } from '@/domain/recovery-budget';

export type TodayQueueCandidate = {
  sentenceId: string; versionId: string; prompt: string; meaning: string; setTitle: string;
  kind: 'NEW' | 'REVIEW'; dueAt: Date | null; scheduledAt: Date | null; estimatedSeconds: number;
};

// Rows are already filtered/ordered by the service. Enrollment order determines
// the winning version; states belong to mode, events/reservations span both modes.
export type TodayQueueInput = {
  plan: StudyPlanValue & { recoveryDate?: string | null };
  mode: StudyMode;
  now: Date;
  enrollments: { set: { title: string; sentences: { sentenceVersion: { id: string; sentenceId: string; prompt: string; meaning: string } }[] } }[];
  states: { sentenceId: string; dueAt: Date | null; lastPracticedAt: Date }[];
  preferences: { sentenceId: string; hidden: boolean; lastExposedAt: Date | null }[];
  dayEvents: { item: { estimatedSeconds: number } }[];
  pendingSessions: { id: string; mode: StudyMode; items: { sentenceId: string; estimatedSeconds: number }[] }[];
  lastEvent: { performedAt: Date } | null;
};

export type TodayQueueResult = {
  dto: TodayQueueDTO;
  selected: TodayQueueCandidate[];
  invalidSessionIds: string[];
};

const DAY = 86_400_000;

/** Pure projection: no queries, writes, implicit clock reads or input mutation. */
export function calculateTodayQueue(input: TodayQueueInput): TodayQueueResult {
  const { plan, mode, now, enrollments, states, preferences, dayEvents, pendingSessions, lastEvent } = input;
  const today = localDate(now, plan.timezone);
  const start = dateStart(today, plan.timezone);
  const calendarRule = { ...plan, paused: false };
  const slot = nextStudyAt(start, calendarRule);
  const availableDate = isStudyDate(today, plan);
  const availableNow = availableDate && Boolean(slot && slot <= now) && !plan.paused;
  const { recovery, effectiveMinutes } = recoveryBudget(plan, lastEvent, now, today);
  const spentSeconds = dayEvents.reduce((sum, event) => sum + event.item.estimatedSeconds, 0);
  const stateById = new Map(states.map((state) => [state.sentenceId, state]));
  const preferenceById = new Map(preferences.map((preference) => [preference.sentenceId, preference]));
  const unique = new Map<string, TodayQueueCandidate>();
  for (const enrollment of enrollments) {
    for (const item of enrollment.set.sentences) {
      const version = item.sentenceVersion;
      if (unique.has(version.sentenceId) || preferenceById.get(version.sentenceId)?.hidden) continue;
      const state = stateById.get(version.sentenceId);
      const exposure = preferenceById.get(version.sentenceId)?.lastExposedAt;
      const dueAt = state ? state.dueAt ?? new Date(state.lastPracticedAt.getTime() + DAY) : null;
      const earliest = dueAt && mode === 'WRITTEN' && exposure ? new Date(Math.max(dueAt.getTime(), exposure.getTime() + DAY)) : dueAt;
      unique.set(version.sentenceId, {
        sentenceId: version.sentenceId, versionId: version.id, prompt: version.prompt, meaning: version.meaning, setTitle: enrollment.set.title,
        kind: state ? 'REVIEW' : 'NEW', dueAt, scheduledAt: earliest ? nextStudyAt(earliest, calendarRule) : slot,
        estimatedSeconds: state ? 30 : 60,
      });
    }
  }
  // Preserve membership-only validity, even when an item's due time/version changed.
  const validPending = pendingSessions.filter((session) => session.items.length > 0 && session.items.every((item) => unique.has(item.sentenceId)));
  const validPendingIds = new Set(validPending.map((session) => session.id));
  const invalidSessionIds = pendingSessions.filter((session) => !validPendingIds.has(session.id)).map((session) => session.id);
  const reservedSeconds = validPending.flatMap((session) => session.items).reduce((sum, item) => sum + item.estimatedSeconds, 0);
  let remainingSeconds = Math.max(0, effectiveMinutes * 60 - spentSeconds - reservedSeconds);
  const active = validPending.find((session) => session.mode === mode);
  const reservedIds = new Set(validPending.filter((session) => session.mode === mode).flatMap((session) => session.items.map((item) => item.sentenceId)));
  const all = [...unique.values()];
  const reviews = all.filter((item) => item.kind === 'REVIEW' && item.scheduledAt && item.scheduledAt <= now && !reservedIds.has(item.sentenceId)).sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime() || a.sentenceId.localeCompare(b.sentenceId));
  const fresh = all.filter((item) => item.kind === 'NEW' && !reservedIds.has(item.sentenceId));
  const selected: TodayQueueCandidate[] = [];
  if (availableNow && !active) {
    for (const item of [...reviews, ...fresh]) {
      if (item.estimatedSeconds > remainingSeconds) continue;
      selected.push({ ...item, scheduledAt: slot });
      remainingSeconds -= item.estimatedSeconds;
    }
  }
  const calendar = Array.from({ length: 14 }, (_, index) => {
    const date = addCalendarDays(today, index);
    return {
      date, available: !plan.paused && isStudyDate(date, plan),
      reviewCount: plan.paused ? 0 : all.filter((item) => item.kind === 'REVIEW' && item.scheduledAt && localDate(item.scheduledAt < start && slot ? slot : item.scheduledAt, plan.timezone) === date).length,
      completedCount: index === 0 ? dayEvents.length : 0,
    };
  });
  const dto: TodayQueueDTO = {
    mode, localDate: today, timezone: plan.timezone, paused: plan.paused, isStudyDay: availableDate,
    nextStudyAt: plan.paused || availableNow ? null : nextStudyAt(now, plan)?.toISOString() ?? null,
    dailyMinutes: plan.dailyMinutes, effectiveMinutes, recovery, completedToday: dayEvents.length,
    // This is the allowance BEFORE the newly selected allocation, not the loop remainder.
    remainingSeconds: Math.max(0, effectiveMinutes * 60 - spentSeconds - reservedSeconds),
    dueCount: reviews.length,
    overdueCount: all.filter((item) => item.dueAt && localDate(item.dueAt, plan.timezone) < today).length,
    newCount: selected.filter((item) => item.kind === 'NEW').length,
    deferredCount: Math.max(0, reviews.length - selected.filter((item) => item.kind === 'REVIEW').length),
    activeSessionId: plan.paused ? null : active?.id ?? null,
    items: selected.map((item) => ({ sentenceId: item.sentenceId, prompt: item.prompt, meaning: item.meaning, setTitle: item.setTitle, kind: item.kind, dueAt: item.dueAt?.toISOString() ?? null, scheduledAt: item.scheduledAt!.toISOString() })),
    calendar,
  };
  return { dto, selected, invalidSessionIds };
}
