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

  async function save() {
    const response = await fetch('/api/v1/sentence-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentenceId: sentence.sentenceId, note, hidden, selfReportedMemorized }),
    });
    setMessage(response.ok ? '저장했습니다.' : ((await response.json().catch(() => ({}))).error ?? '저장하지 못했습니다.'));
  }

  async function report() {
    if (!sentence.sentenceVersionId || !reportDetail.trim()) return;
    const response = await fetch('/api/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentenceVersionId: sentence.sentenceVersionId, reason: 'OTHER', detail: reportDetail }),
    });
    setMessage(response.ok ? '신고를 보냈습니다.' : ((await response.json().catch(() => ({}))).error ?? '신고하지 못했습니다.'));
    if (response.ok) setReportDetail('');
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
        <button className="button-secondary" type="button" onClick={save}><Save size={18} aria-hidden="true" />저장</button>
      </div>
      <label className="field">
        문장 신고
        <input className="input" value={reportDetail} onChange={(event) => setReportDetail(event.target.value)} placeholder="오탈자, 정답, 음원 문제를 적어 주세요." />
      </label>
      <button className="button-ghost" type="button" onClick={report} disabled={!sentence.sentenceVersionId || !reportDetail.trim()}><Flag size={18} aria-hidden="true" />신고</button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
