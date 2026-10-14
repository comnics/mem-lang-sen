'use client';

import { Badge, panelClass } from './ui';

type GroupRow = { form?: string; result?: string | null; status?: string; kind?: string; _count: { _all: number } };
type Quality = {
  denominators: { reports: number; recall: number; application: number };
  events: GroupRow[];
  reports: GroupRow[];
  applicationQuestions: GroupRow[];
  assignments: GroupRow[];
};

export function QualityClient({ metrics }: { metrics: Quality }) {
  return (
    <div className="grid gap-4">
      <section className="grid gap-3 md:grid-cols-3">
        <Metric title="신고 분모" value={metrics.denominators.reports} />
        <Metric title="회상 제출" value={metrics.denominators.recall} />
        <Metric title="응용 제출" value={metrics.denominators.application} />
      </section>
      <MetricList title="회상/응용 결과" rows={metrics.events.map((row) => [`${row.form ?? 'RECALL'} ${row.result ?? '미응답'}`, row._count._all])} />
      <MetricList title="신고 상태" rows={metrics.reports.map((row) => [row.status ?? 'UNKNOWN', row._count._all])} />
      <MetricList title="응용 문항 상태" rows={metrics.applicationQuestions.map((row) => [row.status ?? 'UNKNOWN', row._count._all])} />
      <MetricList title="평가 응시 결과" rows={metrics.assignments.map((row) => [`${row.kind ?? '평가'} ${row.result ?? '미응시'}`, row._count._all])} />
    </div>
  );
}

function Metric({ title, value }: { title: string; value: number }) {
  return <div className={panelClass}><p className="text-sm font-bold text-[#52685d]">{title}</p><strong className="mt-2 block text-3xl">{value}</strong></div>;
}

function MetricList({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <section className={panelClass}>
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {rows.length ? rows.map(([label, value]) => <Badge key={label}>{`${label}: ${value}`}</Badge>) : <span className="text-sm text-[#52685d]">데이터 없음</span>}
      </div>
    </section>
  );
}
