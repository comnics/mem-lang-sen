'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import { importCsv } from './api';
import type { CsvImportResponse, Notice } from './types';
import { EmptyState, NoticeBox, PageHeader, buttonClass, fieldClass, labelClass, panelClass, secondaryButtonClass } from './ui';

const sampleCsv = `prompt,meaning,target,acceptedAnswers,hint,explanation,level
"계산을 마치고 영수증을 요청한다","매장에서 영수증을 받을 수 있는지 묻는 상황","Can I get a receipt?","Could I get a receipt?|May I have a receipt?","Can I get ...?","매장에서 요청할 때 쓰는 표현입니다.",A1`;

export function ImportWorkspace() {
  const [csv, setCsv] = useState(sampleCsv);
  const [preview, setPreview] = useState<CsvImportResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isPending, startTransition] = useTransition();
  const hasErrors = Boolean(preview?.errors.length);

  function run(commit: boolean) {
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await importCsv(csv, commit);
        setPreview(result);
        setNotice({
          tone: result.errors.length ? 'error' : 'success',
          text: commit ? `${result.imported ?? 0}개 문장을 가져왔습니다.` : '미리보기를 완료했습니다.',
        });
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'CSV를 처리하지 못했습니다.' });
      }
    });
  }

  return (
    <>
      <PageHeader title="CSV 가져오기" description="회상 질문 열에는 한국어 상황만 넣고 영어 정답은 정답 문장 열에 따로 넣습니다. CSV를 먼저 미리보기로 검증한 뒤 한 번에 저장합니다." />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <section className={panelClass}>
          <label className="space-y-2">
            <span className={labelClass}>CSV 내용</span>
            <textarea className={`${fieldClass} min-h-[420px] font-mono text-xs leading-5`} value={csv} onChange={(event) => setCsv(event.target.value)} spellCheck={false} />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={secondaryButtonClass} type="button" onClick={() => setCsv(sampleCsv)}>
              예시 넣기
            </button>
            <button className={buttonClass} type="button" onClick={() => run(false)} disabled={isPending || !csv.trim()}>
              <ClipboardList size={17} aria-hidden="true" /> {isPending ? '확인 중' : '미리보기'}
            </button>
            <button className={buttonClass} type="button" onClick={() => run(true)} disabled={isPending || !preview || hasErrors}>
              <CheckCircle2 size={17} aria-hidden="true" /> 전체 저장
            </button>
          </div>
        </section>

        <section className={panelClass} aria-label="CSV 처리 결과">
          <div className="mb-4">
            <NoticeBox notice={notice} />
          </div>
          {preview ? (
            <div className="space-y-4">
              {preview.errors.length ? (
                <div className="rounded-xl border border-[#e2b7aa] bg-[#fff3ef] p-3">
                  <h2 className="font-bold text-[#8f3f2b]">수정이 필요한 행</h2>
                  <ul className="mt-2 space-y-1 text-sm text-[#8f3f2b]">
                    {preview.errors.map((error) => (
                      <li key={`${error.row}-${error.message}`}>{error.row}행: {error.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="text-xs text-[#52685d]">
                    <tr>
                      <th className="py-2 font-bold">행</th>
                      <th className="py-2 font-bold">회상 질문</th>
                      <th className="py-2 font-bold">보조 설명</th>
                      <th className="py-2 font-bold">정답 문장</th>
                      <th className="py-2 font-bold">레벨</th>
                      <th className="py-2 font-bold">허용 답안</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e7df]">
                    {preview.rows.map((row) => (
                      <tr key={row.row}>
                        <td className="py-3">{row.row}</td>
                        <td className="py-3 font-semibold">{row.prompt}</td>
                        <td className="py-3">{row.meaning}</td>
                        <td className="py-3 font-semibold text-[#245d45]">{row.target}</td>
                        <td className="py-3">{row.level}</td>
                        <td className="py-3">{row.acceptedAnswers?.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState>미리보기를 실행하면 행별 처리 결과가 여기에 표시됩니다.</EmptyState>
          )}
        </section>
      </div>
    </>
  );
}
