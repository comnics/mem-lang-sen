import { createRoot } from 'react-dom/client';
import { TodayQueueClient } from '../../src/features/learner/TodayQueueClient';
import { SentenceRecordsClient } from '../../src/features/learner/SentenceRecordsClient';
import { StudySessionClient } from '../../src/features/learner/StudySessionClient';
import type { TodayQueueDTO } from '../../src/domain/m4-types';

export const queue: TodayQueueDTO = {
  mode: 'WRITTEN', localDate: '2026-10-16', timezone: 'Asia/Seoul',
  paused: false, isStudyDay: true, nextStudyAt: null, dailyMinutes: 10,
  effectiveMinutes: 10, recovery: false, completedToday: 0, remainingSeconds: 600,
  dueCount: 1, overdueCount: 0, newCount: 0, deferredCount: 0, activeSessionId: null,
  items: [{ sentenceId: 's1', prompt: '기존 입력 큐', meaning: '뜻', setTitle: '연습',
    kind: 'REVIEW', dueAt: null, scheduledAt: '2026-10-16T00:00:00Z' }], calendar: [],
};
const kind = new URL(location.href).searchParams.get('component');
createRoot(document.getElementById('root')!).render(
  kind === 'today' ? <TodayQueueClient initialQueue={queue} /> :
  kind === 'records' ? <SentenceRecordsClient sentence={{
    sentenceId: 's1', sentenceVersionId: 'v1', note: '', hidden: false, selfReportedMemorized: false,
  }} /> : <StudySessionClient session={{
    id: 'session', userId: 'user', setTitle: '연습', mode: 'WRITTEN', status: 'ACTIVE',
    timezone: 'Asia/Seoul', completedCount: 0,
    items: [
      { id: 'i1', prompt: '첫 문제', meaning: '뜻', position: 1, answered: false },
      { id: 'i2', prompt: '다음 문제', meaning: '뜻', position: 2, answered: false },
    ],
  }} />
);
