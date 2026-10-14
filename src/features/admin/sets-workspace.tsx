'use client';

import { useMemo, useState, useTransition } from 'react';
import { Archive, Copy, Send, UploadCloud } from 'lucide-react';
import { archiveSet, saveSet, transitionSet } from './api';
import type { AdminSentence, AdminSet, Level, Notice, SetCategory } from './types';
import { sentenceVersion, setSentenceVersionIds } from './types';
import { Badge, EmptyState, NoticeBox, PageHeader, buttonClass, categories, dangerButtonClass, fieldClass, labelClass, levels, panelClass, secondaryButtonClass } from './ui';

type SetForm = {
  title: string;
  description: string;
  category: SetCategory;
  level: Level;
  sentenceVersionIds: string[];
};

const emptyForm: SetForm = {
  title: '',
  description: '',
  category: 'SITUATION',
  level: 'A1',
  sentenceVersionIds: [],
};

export function SetsWorkspace({ initialSets, sentences }: { initialSets: AdminSet[]; sentences: AdminSentence[] }) {
  const [sets, setSets] = useState(initialSets);
  const [selectedId, setSelectedId] = useState<string | null>(initialSets[0]?.id ?? null);
  const [form, setForm] = useState<SetForm>(() => toForm(initialSets[0]));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedSet = sets.find((set) => set.id === selectedId);
  const isDraft = !selectedSet || selectedSet.status === 'DRAFT';
  const sentenceOptions = useMemo(() => sentences.map((sentence) => sentenceVersion(sentence)), [sentences]);
  const selectedVersions = useMemo(
    () =>
      form.sentenceVersionIds.map((id) => ({
        id,
        sentence: sentenceOptions.find((option) => option.id === id),
      })),
    [form.sentenceVersionIds, sentenceOptions],
  );

  function selectSet(set: AdminSet | null) {
    setSelectedId(set?.id ?? null);
    setForm(toForm(set));
    setNotice(null);
  }

  function toggleVersion(id: string) {
    setForm((current) => ({
      ...current,
      sentenceVersionIds: current.sentenceVersionIds.includes(id)
        ? current.sentenceVersionIds.filter((versionId) => versionId !== id)
        : [...current.sentenceVersionIds, id],
    }));
  }

  function moveVersion(id: string, direction: -1 | 1) {
    setForm((current) => {
      const index = current.sentenceVersionIds.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.sentenceVersionIds.length) {
        return current;
      }
      const sentenceVersionIds = [...current.sentenceVersionIds];
      [sentenceVersionIds[index], sentenceVersionIds[nextIndex]] = [sentenceVersionIds[nextIndex], sentenceVersionIds[index]];
      return { ...current, sentenceVersionIds };
    });
  }

  function removeVersion(id: string) {
    setForm((current) => ({
      ...current,
      sentenceVersionIds: current.sentenceVersionIds.filter((versionId) => versionId !== id),
    }));
  }

  function submit() {
    setNotice(null);
    startTransition(async () => {
      try {
        if (!isDraft) {
          throw new Error('초안 상태에서만 수정할 수 있습니다. 복제해서 새 초안으로 편집하세요.');
        }

        const saved = normalizeSetResult((await saveSet(form, selectedSet?.id)) as AdminSet, form.sentenceVersionIds);
        setSets((current) => [saved, ...current.filter((set) => set.id !== saved.id)]);
        setSelectedId(saved.id);
        setForm(toForm(saved));
        setNotice({ tone: 'success', text: selectedSet ? '세트 초안을 저장했습니다.' : '새 세트 초안을 만들었습니다.' });
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : '저장하지 못했습니다.' });
      }
    });
  }

  function runTransition(action: 'review' | 'publish' | 'archive' | 'clone') {
    if (!selectedSet) {
      return;
    }

    setNotice(null);
    startTransition(async () => {
      try {
        const result = action === 'archive' ? await archiveSet(selectedSet.id) : await transitionSet(selectedSet.id, action);
        const updated = normalizeSetResult(result as AdminSet, form.sentenceVersionIds);
        setSets((current) => {
          const withoutUpdated = current.filter((set) => set.id !== updated.id);
          const next = action === 'clone' ? withoutUpdated : withoutUpdated.filter((set) => set.id !== selectedSet.id);
          return [updated, ...next];
        });
        setSelectedId(updated.id);
        setForm(toForm(updated));
        const labels = { review: '검토 상태로 보냈습니다.', publish: '세트를 발행했습니다.', archive: '세트를 보관했습니다.', clone: '복제한 초안을 만들었습니다.' };
        setNotice({ tone: 'success', text: labels[action] });
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : '상태를 변경하지 못했습니다.' });
      }
    });
  }

  return (
    <>
      <PageHeader title="세트 관리" description="초안 세트에 문장 버전을 담고 순서를 정합니다. 검토 중이거나 발행된 세트는 복제해서 새 초안으로 편집합니다." />
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <section className={panelClass} aria-label="세트 목록">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">세트</h2>
            <button className={secondaryButtonClass} type="button" onClick={() => selectSet(null)}>
              새 초안
            </button>
          </div>
          <div className="space-y-2">
            {sets.length ? (
              sets.map((set) => (
                <button
                  key={set.id}
                  type="button"
                  onClick={() => selectSet(set)}
                  className={[
                    'w-full rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-[#245d45]',
                    selectedId === set.id ? 'border-[#245d45] bg-[#eef3ec]' : 'border-[#d7dfd5] bg-white hover:bg-[#fafbf8]',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-bold">{set.title}</span>
                    <Badge>{set.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-[#52685d]">{set.level} · {set.sentenceCount ?? setSentenceVersionIds(set).length}문장</p>
                </button>
              ))
            ) : (
              <EmptyState>등록된 세트가 없습니다. 새 초안을 먼저 만들어 주세요.</EmptyState>
            )}
          </div>
        </section>

        <section className={panelClass} aria-label="세트 편집">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{selectedSet ? '세트 편집' : '새 세트 초안'}</h2>
              {selectedSet ? <p className="mt-1 text-sm text-[#52685d]">현재 상태: {selectedSet.status}</p> : null}
              {selectedSet && !isDraft ? <p className="mt-1 text-sm font-semibold text-[#8f3f2b]">이 상태에서는 내용을 고치지 않고 복제해서 새 초안으로 편집합니다.</p> : null}
            </div>
            {selectedSet ? <Badge>{selectedSet.status}</Badge> : null}
          </div>

          <div className="mb-4">
            <NoticeBox notice={notice} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className={labelClass}>제목</span>
              <input className={fieldClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} disabled={!isDraft} />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>레벨</span>
              <select className={fieldClass} value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value as Level })} disabled={!isDraft}>
                {levels.map((level) => <option key={level}>{level}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass}>분류</span>
              <select className={fieldClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as SetCategory })} disabled={!isDraft}>
                {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className={labelClass}>설명</span>
              <textarea className={`${fieldClass} min-h-24`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} disabled={!isDraft} />
            </label>
          </div>

          <fieldset className="mt-5">
            <legend className={labelClass}>문장 버전 선택</legend>
            <div className="mt-2 max-h-[420px] space-y-2 overflow-y-auto rounded-xl border border-[#d7dfd5] bg-[#fafbf8] p-2">
              {sentenceOptions.length ? (
                sentenceOptions.map((sentence) => (
                  <label key={sentence.id} className="flex gap-3 rounded-lg bg-white p-3 text-sm shadow-sm">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-[#245d45]"
                      checked={form.sentenceVersionIds.includes(sentence.id)}
                      onChange={() => toggleVersion(sentence.id)}
                      disabled={!isDraft}
                    />
                    <span>
                      <span className="block font-bold">{sentence.prompt}</span>
                      <span className="block text-[#52685d]">{sentence.meaning}</span>
                    </span>
                  </label>
                ))
              ) : (
                <EmptyState>선택할 문장 버전이 없습니다. 문장 관리에서 먼저 문장을 만들어 주세요.</EmptyState>
              )}
            </div>
          </fieldset>

          <section className="mt-5 rounded-xl border border-[#d7dfd5] bg-[#fafbf8] p-3" aria-label="선택한 문장 순서">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-bold">선택한 순서</h3>
              <span className="text-sm font-semibold text-[#52685d]">{form.sentenceVersionIds.length}개</span>
            </div>
            {form.sentenceVersionIds.length ? (
              <ol className="space-y-2">
                {selectedVersions.map(({ id, sentence }, index) => {
                  return (
                    <li key={id} className="grid gap-2 rounded-lg bg-white p-3 text-sm shadow-sm sm:grid-cols-[2rem_1fr_auto] sm:items-center">
                      <span className="font-bold text-[#245d45]">{index + 1}</span>
                      <span>
                        <span className="block font-bold">{sentence?.prompt ?? id}</span>
                        {sentence?.meaning ? <span className="block text-[#52685d]">{sentence.meaning}</span> : null}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        <button className={secondaryButtonClass} type="button" onClick={() => moveVersion(id, -1)} disabled={!isDraft || index === 0}>위</button>
                        <button className={secondaryButtonClass} type="button" onClick={() => moveVersion(id, 1)} disabled={!isDraft || index === form.sentenceVersionIds.length - 1}>아래</button>
                        <button className={dangerButtonClass} type="button" onClick={() => removeVersion(id)} disabled={!isDraft}>제거</button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <EmptyState>선택한 문장이 없습니다. 위 목록에서 세트에 담을 문장을 선택하세요.</EmptyState>
            )}
          </section>

          <section className="mt-5 rounded-xl border border-[#d7dfd5] bg-white p-3" aria-label="발행 전 미리보기">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-bold">발행 전 미리보기</h3>
              <span className="text-sm font-semibold text-[#52685d]">정답 노출 확인</span>
            </div>
            {selectedVersions.length ? (
              <div className="space-y-3">
                {selectedVersions.map(({ id, sentence }, index) => (
                  <article key={id} className="rounded-lg border border-[#e2e7df] bg-[#fafbf8] p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-bold">{index + 1}. {sentence?.prompt ?? '문장 정보를 찾을 수 없습니다.'}</h4>
                      <Badge>{sentence?.audioAssetId ? '오디오 준비됨' : '오디오 필요'}</Badge>
                    </div>
                    {sentence ? (
                      <dl className="mt-2 grid gap-2 text-[#52685d] md:grid-cols-2">
                        <div>
                          <dt className="font-bold text-[#203c32]">보조 설명</dt>
                          <dd>{sentence.meaning}</dd>
                        </div>
                        <div>
                          <dt className="font-bold text-[#203c32]">정답 문장</dt>
                          <dd className="font-semibold text-[#245d45]">{sentence.target || '정답 없음'}</dd>
                        </div>
                        <div className="md:col-span-2">
                          <dt className="font-bold text-[#203c32]">허용 답안</dt>
                          <dd>{sentence.acceptedAnswers.length ? sentence.acceptedAnswers.join(', ') : '허용 답안 없음'}</dd>
                        </div>
                      </dl>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState>선택한 문장이 없습니다. 문장을 선택하면 발행 전 확인 내용이 표시됩니다.</EmptyState>
            )}
          </section>

          <div className="mt-5 flex flex-wrap gap-2">
            <button className={buttonClass} type="button" onClick={submit} disabled={isPending || !isDraft || !form.title || !form.sentenceVersionIds.length}>
              {isPending ? '저장 중' : '초안 저장'}
            </button>
            <button className={secondaryButtonClass} type="button" onClick={() => runTransition('review')} disabled={isPending || !selectedSet || selectedSet.status !== 'DRAFT'}>
              <Send size={17} aria-hidden="true" /> 검토 요청
            </button>
            <button className={secondaryButtonClass} type="button" onClick={() => runTransition('publish')} disabled={isPending || !selectedSet || selectedSet.status !== 'REVIEW'}>
              <UploadCloud size={17} aria-hidden="true" /> 발행
            </button>
            <button className={secondaryButtonClass} type="button" onClick={() => runTransition('clone')} disabled={isPending || !selectedSet}>
              <Copy size={17} aria-hidden="true" /> 복제
            </button>
            <button className={dangerButtonClass} type="button" onClick={() => runTransition('archive')} disabled={isPending || !selectedSet || selectedSet.status === 'ARCHIVED'}>
              <Archive size={17} aria-hidden="true" /> 보관
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function toForm(set?: AdminSet | null): SetForm {
  if (!set) {
    return emptyForm;
  }

  return {
    title: set.title,
    description: set.description,
    category: set.category,
    level: set.level,
    sentenceVersionIds: setSentenceVersionIds(set),
  };
}

function normalizeSetResult(set: AdminSet, fallbackSentenceVersionIds: string[]): AdminSet {
  const ids = setSentenceVersionIds(set);
  if (ids.length) {
    return set;
  }

  return { ...set, sentenceVersionIds: fallbackSentenceVersionIds };
}
