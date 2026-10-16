'use client';

import { useState } from 'react';
import { Flag, Save } from 'lucide-react';

type SentenceRecord = {
  sentenceId: string;
  sentenceVersionId: string | null;
  note: string;
  hidden: boolean;
  selfReportedMemorized: boolean;
};

export function SentenceRecordsClient({ sentence }: { sentence: SentenceRecord }) {
  const [note, setNote] = useState(sentence.note);
  const [hidden, setHidden] = useState(sentence.hidden);
  const [selfReportedMemorized, setSelfReportedMemorized] = useState(sentence.selfReportedMemorized);
  const [reportDetail, setReportDetail] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const [pending, setPending] = useState<'save' | 'report' | null>(null);
  const [failed, setFailed] = useState(false);

  async function perform(action: 'save' | 'report') {
    if (pending || (action === 'report' && (!sentence.sentenceVersionId || !reportDetail.trim()))) return;
    setPending(action);
    setMessage(null);
    setFailed(false);
    try {
      const response = await fetch(action === 'save' ? '/api/v1/sentence-preferences' : '/api/v1/reports', {
        method: action === 'save' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'save'
          ? { sentenceId: sentence.sentenceId, note, hidden, selfReportedMemorized }
          : { sentenceVersionId: sentence.sentenceVersionId, reason: 'OTHER', detail: reportDetail }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? '요청을 처리하지 못했습니다.');
      setMessage(action === 'save' ? '저장했습니다.' : '신고를 보냈습니다.');
      if (action === 'report') setReportDetail('');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="stack">
      <label className="field">
        개인 메모
        <textarea className="textarea" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} />
      </label>
      <label className="check-line">
        <input type="checkbox" checked={selfReportedMemorized} onChange={(event) => setSelfReportedMemorized(event.target.checked)} />
        <span>내가 외웠다고 표시</span>
      </label>
      <label className="check-line">
        <input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />
        <span>오늘 큐에서 숨기기</span>
      </label>
      <div className="button-row">
        <button className="button-secondary" type="button" onClick={() => perform('save')} disabled={Boolean(pending)}><Save size={18} aria-hidden="true" />{pending === 'save' ? '저장 중' : '저장'}</button>
      </div>
      <label className="field">
        문장 신고
        <input className="input" disabled={pending === 'report'} value={reportDetail} onChange={(event) => setReportDetail(event.target.value)} placeholder="오탈자, 정답, 음원 문제를 적어 주세요." />
      </label>
      <button className="button-ghost" type="button" onClick={() => perform('report')} disabled={Boolean(pending) || !sentence.sentenceVersionId || !reportDetail.trim()}><Flag size={18} aria-hidden="true" />{pending === 'report' ? '신고 중' : '신고'}</button>
      {message ? <p className={failed ? 'notice notice-error' : 'notice notice-success'} role={failed ? 'alert' : 'status'}>{message}</p> : null}
    </div>
  );
}
