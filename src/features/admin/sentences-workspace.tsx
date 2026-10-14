'use client';

import { useState, useTransition } from 'react';
import { Headphones, Save } from 'lucide-react';
import { saveSentence, uploadAudio, type SentencePayload } from './api';
import type { AdminSentence, Level, Notice } from './types';
import { sentenceVersion } from './types';
import { Badge, EmptyState, NoticeBox, PageHeader, buttonClass, fieldClass, labelClass, levels, panelClass, secondaryButtonClass } from './ui';

type SentenceForm = SentencePayload;

const emptyForm: SentenceForm = {
  prompt: '',
  meaning: '',
  target: '',
  acceptedAnswers: [],
  hint: '',
  explanation: '',
  language: 'en',
  level: 'A1',
};

export function SentencesWorkspace({ initialSentences }: { initialSentences: AdminSentence[] }) {
  const [sentences, setSentences] = useState(initialSentences);
  const [selectedId, setSelectedId] = useState<string | null>(initialSentences[0]?.id ?? null);
  const [form, setForm] = useState<SentenceForm>(() => toForm(initialSentences[0]));
  const [answersText, setAnswersText] = useState(() => toForm(initialSentences[0]).acceptedAnswers.join('\n'));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isPending, startTransition] = useTransition();
  const selected = sentences.find((sentence) => sentence.id === selectedId);

  function selectSentence(sentence: AdminSentence | null) {
    const next = toForm(sentence);
    setSelectedId(sentence?.id ?? null);
    setForm(next);
    setAnswersText(next.acceptedAnswers.join('\n'));
    setNotice(null);
  }

  function submit() {
    const payload = { ...form, acceptedAnswers: parseAnswers(answersText) };
    setNotice(null);
    startTransition(async () => {
      try {
        const saved = (await saveSentence(payload, selected?.id)) as AdminSentence;
        setSentences((current) => [saved, ...current.filter((sentence) => sentence.id !== saved.id)]);
        setSelectedId(saved.id);
        setForm(toForm(saved));
        setAnswersText(toForm(saved).acceptedAnswers.join('\n'));
        setNotice({ tone: 'success', text: selected ? '새 문장 버전을 만들었습니다.' : '문장을 만들었습니다.' });
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : '문장을 저장하지 못했습니다.' });
      }
    });
  }

  function attachAudio(file: File | null) {
    if (!file) {
      return;
    }

    setNotice({ tone: 'info', text: '오디오를 비공개 저장소에 업로드하고 있습니다.' });
    startTransition(async () => {
      try {
        const audioAssetId = await uploadAudio(file);
        setForm((current) => ({ ...current, audioAssetId }));
        setNotice({ tone: 'success', text: '오디오 업로드를 완료했습니다. 저장하면 이 문장 버전에 연결됩니다.' });
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : '오디오 업로드에 실패했습니다.' });
      }
    });
  }

  return (
    <>
      <PageHeader title="문장 관리" description="회상 질문에는 한국어 상황만 입력합니다. 영어 정답은 학습자가 시도한 뒤 확인할 수 있도록 정답 문장에 따로 보관합니다." />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <section className={panelClass} aria-label="문장 목록">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">문장</h2>
            <button className={secondaryButtonClass} type="button" onClick={() => selectSentence(null)}>
              새 문장
            </button>
          </div>
          <div className="space-y-2">
            {sentences.length ? (
              sentences.map((sentence) => {
                const version = sentenceVersion(sentence);
                return (
                  <button
                    key={sentence.id}
                    type="button"
                    onClick={() => selectSentence(sentence)}
                    className={[
                      'w-full rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-[#245d45]',
                      selectedId === sentence.id ? 'border-[#245d45] bg-[#eef3ec]' : 'border-[#d7dfd5] bg-white hover:bg-[#fafbf8]',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-bold">{version.prompt}</span>
                      <Badge>{version.level}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-[#52685d]">{version.meaning}</p>
                  </button>
                );
              })
            ) : (
              <EmptyState>아직 등록된 문장이 없습니다. 새 문장을 만들어 세트에 연결하세요.</EmptyState>
            )}
          </div>
        </section>

        <section className={panelClass} aria-label="문장 편집">
          <div className="mb-4">
            <h2 className="text-lg font-bold">{selected ? '문장 버전 편집' : '새 문장'}</h2>
            <p className="mt-1 text-sm text-[#52685d]">
              {selected ? '저장 시 기존 버전을 덮어쓰지 않고 새 버전을 만듭니다.' : '새 문장은 초안 세트에 바로 선택할 수 있습니다.'}
            </p>
          </div>
          <div className="mb-4">
            <NoticeBox notice={notice} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className={labelClass}>회상 질문 · 한국어 상황</span>
              <input className={fieldClass} value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className={labelClass}>보조 뜻 · 상황 설명</span>
              <input className={fieldClass} value={form.meaning} onChange={(event) => setForm({ ...form, meaning: event.target.value })} />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className={labelClass}>정답 문장</span>
              <input className={fieldClass} value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>레벨</span>
              <select className={fieldClass} value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value as Level })}>
                {levels.map((level) => <option key={level}>{level}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass}>오디오</span>
              <input className={fieldClass} type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg" onChange={(event) => attachAudio(event.target.files?.[0] ?? null)} />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className={labelClass}>허용 답안</span>
              <textarea className={`${fieldClass} min-h-28`} value={answersText} onChange={(event) => setAnswersText(event.target.value)} placeholder="한 줄에 하나씩 입력" />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className={labelClass}>힌트</span>
              <textarea className={`${fieldClass} min-h-20`} value={form.hint} onChange={(event) => setForm({ ...form, hint: event.target.value })} />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className={labelClass}>해설</span>
              <textarea className={`${fieldClass} min-h-24`} value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button className={buttonClass} type="button" onClick={submit} disabled={isPending || !form.prompt || !form.meaning || !form.target}>
              <Save size={17} aria-hidden="true" /> {isPending ? '저장 중' : selected ? '새 버전 저장' : '문장 저장'}
            </button>
            {form.audioAssetId ? (
              <span className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#edf7ef] px-3 text-sm font-bold text-[#245d45]">
                <Headphones size={17} aria-hidden="true" /> 오디오 연결됨
              </span>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

function parseAnswers(value: string) {
  return value
    .split('\n')
    .map((answer) => answer.trim())
    .filter(Boolean);
}

function toForm(sentence?: AdminSentence | null): SentenceForm {
  if (!sentence) {
    return emptyForm;
  }

  const version = sentenceVersion(sentence);
  return {
    prompt: version.prompt,
    meaning: version.meaning,
    target: version.target,
    acceptedAnswers: version.acceptedAnswers,
    hint: version.hint,
    explanation: version.explanation,
    language: 'en',
    level: version.level,
    audioAssetId: version.audioAssetId ?? undefined,
  };
}
