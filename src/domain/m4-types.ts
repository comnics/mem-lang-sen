export type StudyMode = 'WRITTEN' | 'SPOKEN';

export type StudyPlanValue = {
  displayName: string;
  dailyMinutes: number;
  timezone: string;
  weekdays: number[];
  ruleType: 'WEEKDAYS' | 'INTERVAL';
  intervalDays: number;
  anchorDate: string;
  startDate: string;
  targetDate: string | null;
  localTime: string;
  paused: boolean;
  exceptions: { date: string; kind: 'ADD' | 'SKIP' }[];
};

export type TodayQueueDTO = {
  mode: StudyMode;
  localDate: string;
  timezone: string;
  paused: boolean;
  isStudyDay: boolean;
  nextStudyAt: string | null;
  dailyMinutes: number;
  effectiveMinutes: number;
  recovery: boolean;
  completedToday: number;
  remainingSeconds: number;
  dueCount: number;
  overdueCount: number;
  newCount: number;
  deferredCount: number;
  activeSessionId: string | null;
  items: {
    sentenceId: string;
    prompt: string;
    meaning: string;
    setTitle: string;
    kind: 'REVIEW' | 'NEW';
    dueAt: string | null;
    scheduledAt: string;
  }[];
  calendar: { date: string; available: boolean; reviewCount: number; completedCount: number }[];
};
