import { defaultSchedule } from '@/domain/scheduling';
import type { StudyMode } from '@/domain/m4-types';

const now = new Date('2026-10-14T01:00:00.000Z');
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const version = (sentenceId: string, id = `v-${sentenceId}`) => ({ id, sentenceId, prompt: `Prompt ${id}`, meaning: `Meaning ${id}` });

export function queueInput() {
  return {
    plan: { ...defaultSchedule(now), displayName: 'Learner', dailyMinutes: 5, recoveryDate: null as string | null },
    mode: 'WRITTEN' as StudyMode,
    now,
    enrollments: [
      { set: { title: 'First', sentences: ['new', 'b', 'a', 'hidden'].map((id) => ({ sentenceVersion: version(id) })) } },
      { set: { title: 'Second', sentences: [{ sentenceVersion: version('a', 'later-version') }, { sentenceVersion: version('last') }] } },
    ],
    states: ['b', 'a'].map((sentenceId) => ({ sentenceId, dueAt: ago(2) as Date | null, lastPracticedAt: ago(4) })),
    preferences: [{ sentenceId: 'hidden', hidden: true, lastExposedAt: null as Date | null }],
    dayEvents: [] as { item: { estimatedSeconds: number } }[],
    pendingSessions: [] as { id: string; mode: StudyMode; items: { sentenceId: string; estimatedSeconds: number }[] }[],
    lastEvent: null as { performedAt: Date } | null,
  };
}

export type QueueFixtureInput = ReturnType<typeof queueInput>;
const pending = (id: string, mode: StudyMode, sentenceIds: string[]) => ({ id, mode, items: sentenceIds.map((sentenceId) => ({ sentenceId, estimatedSeconds: 60 })) });

export const queueCases: [string, (input: QueueFixtureInput) => void][] = [
  ['ordered versions and review ties', () => {}],
  ['paused', (i) => { i.plan.paused = true; i.pendingSessions = [pending('resume', 'WRITTEN', ['new'])]; }],
  ['before study time', (i) => { i.now = new Date('2026-10-13T23:59:59.999Z'); }],
  ['default plan', () => {}],
  ['hidden and unenrolled pending', (i) => { i.pendingSessions = [pending('hidden', 'WRITTEN', ['hidden']), pending('gone', 'SPOKEN', ['unenrolled']), pending('empty', 'WRITTEN', [])]; }],
  ['cross-mode reservation permits same sentence', (i) => { i.pendingSessions = [pending('spoken', 'SPOKEN', ['a'])]; }],
  ['same-mode resume ignores due time and old version', (i) => { i.preferences.push({ sentenceId: 'a', hidden: false, lastExposedAt: now }); i.pendingSessions = [pending('first', 'WRITTEN', ['a']), pending('second', 'WRITTEN', ['b'])]; }],
  ['exhausted budget', (i) => { i.dayEvents = [{ item: { estimatedSeconds: 300 } }]; }],
  ['partial reservation skips expensive new item', (i) => { i.dayEvents = [{ item: { estimatedSeconds: 195 } }]; i.pendingSessions = [pending('spoken', 'SPOKEN', ['new'])]; }],
  ['recovery cap', (i) => { i.plan.dailyMinutes = 20; i.lastEvent = { performedAt: ago(7) }; }],
  ['persisted recovery after recent answer', (i) => { i.plan.dailyMinutes = 20; i.plan.recoveryDate = '2026-10-14'; i.lastEvent = { performedAt: now }; }],
  ['written exposure just inside 24h', (i) => { i.preferences.push({ sentenceId: 'a', hidden: false, lastExposedAt: new Date(ago(1).getTime() + 1) }); }],
  ['written exposure at 24h', (i) => { i.preferences.push({ sentenceId: 'a', hidden: false, lastExposedAt: ago(1) }); }],
  ['spoken exposure not deferred', (i) => { i.mode = 'SPOKEN'; i.preferences.push({ sentenceId: 'a', hidden: false, lastExposedAt: now }); }],
  ['null dueAt uses last practice plus 24h', (i) => { i.states[0]!.dueAt = null; }],
  ['calendar exceptions and future reviews', (i) => { i.plan.exceptions = [{ date: '2026-10-14', kind: 'SKIP' }, { date: '2026-10-17', kind: 'ADD' }]; i.states[0]!.dueAt = new Date('2026-10-20T01:00:00Z'); }],
];
