'use client';

import { useState } from 'react';
import { Badge, buttonClass, fieldClass, labelClass, secondaryButtonClass, panelClass } from './ui';

type SentenceOption = { id: string; prompt: string; meaning: string; target: string };
type Question = {
  id: string;
  sentenceVersionId: string;
  prompt: string;
  meaning: string;
  target: string;
  acceptedAnswers: string[];
  explanation: string;
  status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
  sentenceVersion?: { prompt: string; target: string };
};

export function ApplicationQuestionsClient({ initialQuestions, sentences }: { initialQuestions: Question[]; sentences: SentenceOption[] }) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    sentenceVersionId: sentences[0]?.id ?? '',
    prompt: '',
    meaning: '',
    target: '',
    acceptedAnswers: '',
    explanation: '',
  });

  async function create() {
    const response = await fetch('/api/v1/admin/application-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        acceptedAnswers: form.acceptedAnswers.split('\n').map((value) => value.trim()).filter(Boolean),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data.error ?? '응용 문항을 만들지 못했습니다.');
      return;
    }
    setQuestions((current) => [data, ...current]);
    setNotice('응용 문항을 만들었습니다.');
  }

  async function setStatus(id: string, status: 'REVIEW' | 'PUBLISHED' | 'ARCHIVED') {
    const response = await fetch(`/api/v1/admin/application-questions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data.error ?? '상태를 바꾸지 못했습니다.');
      return;
    }
    setQuestions((current) => current.map((question) => question.id === id ? data : question));
    setNotice('상태를 변경했습니다.');
  }

  return (
    <div className="grid gap-4">
      {notice ? <div className="rounded-lg border border-[#c7d3c9] bg-[#f4f8f3] px-3 py-2 text-sm font-semibold text-[#385a4c]">{notice}</div> : null}
      <section className={panelClass}>
        <h2 className="text-lg font-bold">응용 문항 추가</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className={labelClass}>원 문장
            <select className={`${fieldClass} mt-1`} value={form.sentenceVersionId} onChange={(event) => setForm((current) => ({ ...current, sentenceVersionId: event.target.value }))}>
              {sentences.map((sentence) => <option key={sentence.id} value={sentence.id}>{sentence.prompt}</option>)}
            </select>
          </label>
          <label className={labelClass}>상황 단서
            <input className={`${fieldClass} mt-1`} value={form.prompt} onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))} />
          </label>
          <label className={labelClass}>의미
            <input className={`${fieldClass} mt-1`} value={form.meaning} onChange={(event) => setForm((current) => ({ ...current, meaning: event.target.value }))} />
          </label>
          <label className={labelClass}>정답
            <input className={`${fieldClass} mt-1`} value={form.target} onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))} />
          </label>
          <label className={`${labelClass} md:col-span-2`}>허용 답안
            <textarea className={`${fieldClass} mt-1 min-h-28`} value={form.acceptedAnswers} onChange={(event) => setForm((current) => ({ ...current, acceptedAnswers: event.target.value }))} />
          </label>
          <label className={`${labelClass} md:col-span-2`}>설명
            <textarea className={`${fieldClass} mt-1 min-h-28`} value={form.explanation} onChange={(event) => setForm((current) => ({ ...current, explanation: event.target.value }))} />
          </label>
        </div>
        <button className={`${buttonClass} mt-4`} type="button" onClick={create}>추가</button>
      </section>
      <section className="grid gap-3">
        {questions.map((question) => (
          <article className={panelClass} key={question.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">{question.prompt}</h2>
              <Badge>{statusLabel(question.status)}</Badge>
            </div>
            <p className="mt-2 text-sm text-[#52685d]">{question.meaning}</p>
            <p className="mt-2 text-sm font-semibold text-[#203c32]">{question.target}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {question.status === 'DRAFT' ? <button className={secondaryButtonClass} type="button" onClick={() => setStatus(question.id, 'REVIEW')}>검수 요청</button> : null}
              {question.status === 'REVIEW' ? <button className={buttonClass} type="button" onClick={() => setStatus(question.id, 'PUBLISHED')}>발행</button> : null}
              {question.status !== 'ARCHIVED' ? <button className={secondaryButtonClass} type="button" onClick={() => setStatus(question.id, 'ARCHIVED')}>보관</button> : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function statusLabel(status: string) {
  if (status === 'DRAFT') return '초안';
  if (status === 'REVIEW') return '검수';
  if (status === 'PUBLISHED') return '발행';
  if (status === 'ARCHIVED') return '보관';
  return status;
}
