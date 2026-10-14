'use client';

import { useState } from 'react';
import { Badge, buttonClass, panelClass, secondaryButtonClass } from './ui';

type Report = {
  id: string;
  reason: string;
  detail: string;
  status: string;
  resolution: string | null;
  createdAt: string | Date;
  sentenceVersion: { prompt: string; target: string };
  user: { email: string; displayName: string | null };
};

export function ReportsClient({ initialReports }: { initialReports: Report[] }) {
  const [reports, setReports] = useState(initialReports);
  const [message, setMessage] = useState<string | null>(null);

  async function update(id: string, status: 'RESOLVED' | 'DISMISSED') {
    const response = await fetch('/api/v1/admin/reports', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, resolution: status === 'RESOLVED' ? '확인 후 처리했습니다.' : '추가 조치 없이 닫았습니다.' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error ?? '신고를 처리하지 못했습니다.');
      return;
    }
    setReports((current) => current.map((report) => report.id === id ? { ...report, status: data.status, resolution: data.resolution } : report));
    setMessage('신고 상태를 변경했습니다.');
  }

  return (
    <div className="grid gap-3">
      {message ? <div className="rounded-lg border border-[#c7d3c9] bg-[#f4f8f3] px-3 py-2 text-sm font-semibold text-[#385a4c]">{message}</div> : null}
      {reports.map((report) => (
        <article className={panelClass} key={report.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{report.sentenceVersion.prompt}</h2>
            <Badge>{report.status}</Badge>
          </div>
          <p className="mt-2 text-sm text-[#52685d]">{report.reason} · {report.user.email}</p>
          <p className="mt-3 rounded-lg bg-[#f6f5f0] p-3 text-sm text-[#203c32]">{report.detail}</p>
          <p className="mt-2 text-sm font-semibold text-[#203c32]">{report.sentenceVersion.target}</p>
          {report.resolution ? <p className="mt-2 text-sm text-[#52685d]">{report.resolution}</p> : null}
          {report.status === 'OPEN' ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button className={buttonClass} type="button" onClick={() => update(report.id, 'RESOLVED')}>해결</button>
              <button className={secondaryButtonClass} type="button" onClick={() => update(report.id, 'DISMISSED')}>기각</button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
