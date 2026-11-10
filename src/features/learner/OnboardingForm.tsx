'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Pause, Plus, Trash2 } from 'lucide-react';
import type { StudyPlanValue } from '@/domain/m4-types';
import { todayLocalDate } from './format';

const weekdayOptions = [
  ['1', '월'],
  ['2', '화'],
  ['3', '수'],
  ['4', '목'],
  ['5', '금'],
  ['6', '토'],
  ['0', '일'],
] as const;

export function OnboardingForm({
  displayName,
  studyPlan,
}: {
  displayName: string | null;
  studyPlan: StudyPlanValue | null;
}) {
  const router = useRouter();
  const fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  const fallbackDate = todayLocalDate(studyPlan?.timezone ?? fallbackTimezone);
  const [ruleType, setRuleType] = useState<StudyPlanValue['ruleType']>(studyPlan?.ruleType ?? 'WEEKDAYS');
  const [exceptions, setExceptions] = useState<StudyPlanValue['exceptions']>(studyPlan?.exceptions ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedWeekdays = studyPlan?.weekdays ?? [1, 2, 3, 4, 5];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const weekdays = form.getAll('weekdays').map((value) => Number(value));
    const body = {
      displayName: String(form.get('displayName') ?? '').trim(),
      dailyMinutes: Number(form.get('dailyMinutes')),
      timezone: String(form.get('timezone') ?? '').trim(),
      weekdays,
      ruleType,
      intervalDays: Number(form.get('intervalDays')),
      anchorDate: String(form.get('anchorDate') ?? ''),
      startDate: String(form.get('startDate') ?? ''),
      targetDate: String(form.get('targetDate') ?? '').trim() || null,
      localTime: String(form.get('localTime') ?? '09:00'),
      paused: form.get('paused') === 'on',
      exceptions,
    };

    try {
      const response = await fetch('/api/v1/study-plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? '설정을 저장하지 못했습니다.');
      router.push('/today');
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '설정을 저장하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} aria-describedby={error ? 'plan-error' : undefined}>
      <label className="field">
        표시 이름
        <input className="input" name="displayName" defaultValue={studyPlan?.displayName ?? displayName ?? ''} required maxLength={80} />
      </label>
      <label className="field">
        하루 학습 시간
        <select className="select" name="dailyMinutes" defaultValue={String(studyPlan?.dailyMinutes ?? 5)}>
          {[3, 5, 10, 15, 20].map((value) => (
            <option key={value} value={value}>{value}분</option>
          ))}
        </select>
      </label>
      <label className="field">
        시간대
        <input className="input" name="timezone" defaultValue={studyPlan?.timezone ?? fallbackTimezone} list="timezone-options" required maxLength={80} />
        <datalist id="timezone-options">
          <option value="Asia/Seoul" />
          <option value="America/Los_Angeles" />
          <option value="America/New_York" />
          <option value="Europe/London" />
          <option value="UTC" />
        </datalist>
      </label>
      <div className="grid-2">
        <label className="field">
          시작일
          <input className="input" name="startDate" type="date" defaultValue={studyPlan?.startDate ?? fallbackDate} required />
        </label>
        <label className="field">
          학습 시간
          <input className="input" name="localTime" type="time" defaultValue={studyPlan?.localTime ?? '09:00'} required />
        </label>
      </div>
      <fieldset className="field">
        <legend>학습 규칙</legend>
        <div className="segmented-control">
          <label>
            <input type="radio" name="ruleType" value="WEEKDAYS" checked={ruleType === 'WEEKDAYS'} onChange={() => setRuleType('WEEKDAYS')} />
            <span>요일별</span>
          </label>
          <label>
            <input type="radio" name="ruleType" value="INTERVAL" checked={ruleType === 'INTERVAL'} onChange={() => setRuleType('INTERVAL')} />
            <span>주기별</span>
          </label>
        </div>
      </fieldset>
      {ruleType === 'WEEKDAYS' ? (
        <fieldset className="field">
          <legend>학습 요일</legend>
          <div className="weekday-grid">
            {weekdayOptions.map(([value, label]) => (
              <label key={value} className="check-pill">
                <input name="weekdays" type="checkbox" value={value} defaultChecked={selectedWeekdays.includes(Number(value))} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <div className="grid-2">
          <label className="field">
            반복 간격
            <input className="input" name="intervalDays" type="number" min={1} max={30} defaultValue={studyPlan?.intervalDays ?? 2} required />
          </label>
          <label className="field">
            기준일
            <input className="input" name="anchorDate" type="date" defaultValue={studyPlan?.anchorDate ?? fallbackDate} required />
          </label>
        </div>
      )}
      {ruleType === 'WEEKDAYS' ? (
        <input type="hidden" name="anchorDate" value={studyPlan?.anchorDate ?? fallbackDate} />
      ) : (
        selectedWeekdays.map((day) => <input key={day} type="hidden" name="weekdays" value={day} />)
      )}
      {ruleType === 'WEEKDAYS' ? <input type="hidden" name="intervalDays" value={studyPlan?.intervalDays ?? 2} /> : null}
      <label className="field">
        목표일
        <input className="input" name="targetDate" type="date" defaultValue={studyPlan?.targetDate ?? ''} />
        <span className="muted">목표일은 계획을 설명하는 용도이며 복습을 멈추는 기준으로 쓰지 않습니다.</span>
      </label>
      <section className="card-quiet stack">
        <div className="split-row exception-heading">
          <div>
            <strong>날짜 예외</strong>
            <p className="muted">특정 날짜를 추가하거나 쉬는 날로 표시합니다.</p>
          </div>
          <button className="button-secondary" type="button" onClick={() => setExceptions((current) => [...current, { date: fallbackDate, kind: 'ADD' }])}>
            <Plus size={18} aria-hidden="true" /> 추가
          </button>
        </div>
        {exceptions.length ? (
          <div className="list">
            {exceptions.map((exception, index) => (
              <div className="exception-row" key={`${exception.date}-${index}`}>
                <input
                  className="input"
                  type="date"
                  value={exception.date}
                  onChange={(event) => updateException(index, { ...exception, date: event.target.value })}
                  aria-label="예외 날짜"
                />
                <select
                  className="select"
                  value={exception.kind}
                  onChange={(event) => updateException(index, { ...exception, kind: event.target.value as 'ADD' | 'SKIP' })}
                  aria-label="예외 종류"
                >
                  <option value="ADD">학습 추가</option>
                  <option value="SKIP">쉬는 날</option>
                </select>
                <button className="button-ghost icon-button" type="button" onClick={() => setExceptions((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${exception.date} 예외 삭제`}>
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">추가된 예외 날짜가 없습니다.</p>
        )}
      </section>
      <label className="check-line">
        <input name="paused" type="checkbox" defaultChecked={studyPlan?.paused ?? false} />
        <span><Pause size={18} aria-hidden="true" /> 전체 오늘 학습을 잠시 멈추기</span>
      </label>
      {error ? <p id="plan-error" className="notice notice-error" role="alert">{error}</p> : null}
      <button className="button button-full" type="submit" disabled={pending}>
        {pending ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
        {pending ? '설정 저장 중' : '오늘 학습으로 이동'}
      </button>
      <p className="muted">저장한 일정은 오늘 학습 큐와 복습 반복에 반영됩니다.</p>
    </form>
  );

  function updateException(index: number, next: StudyPlanValue['exceptions'][number]) {
    setExceptions((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
  }
}
