import type { AdminSentence, AdminSet } from './types';
import { sentenceVersion } from './types';
import { Badge, EmptyState, PageHeader, panelClass } from './ui';

function countByStatus(sets: AdminSet[], status: AdminSet['status']) {
  return sets.filter((set) => set.status === status).length;
}

export function AdminDashboard({ sets, sentences }: { sets: AdminSet[]; sentences: AdminSentence[] }) {
  const audioReady = sentences.filter((sentence) => sentenceVersion(sentence).audioAssetId).length;
  const recentSets = sets.slice(0, 5);

  return (
    <>
      <PageHeader title="관리자 개요" description="실제 등록된 세트와 문장만 보여줍니다. 검토, 발행, 보관 상태를 확인하고 필요한 관리 화면으로 이동하세요." />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="관리 현황">
        <Stat label="전체 세트" value={sets.length} />
        <Stat label="검토 대기" value={countByStatus(sets, 'REVIEW')} />
        <Stat label="발행됨" value={countByStatus(sets, 'PUBLISHED')} />
        <Stat label="오디오 연결 문장" value={`${audioReady}/${sentences.length}`} />
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className={panelClass}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">최근 세트</h2>
            <Badge>{`${sets.length}개`}</Badge>
          </div>
          {recentSets.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-[#52685d]">
                  <tr>
                    <th className="py-2 font-bold">제목</th>
                    <th className="py-2 font-bold">상태</th>
                    <th className="py-2 font-bold">레벨</th>
                    <th className="py-2 text-right font-bold">문장</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e2e7df]">
                  {recentSets.map((set) => (
                    <tr key={set.id}>
                      <td className="py-3 font-semibold">{set.title}</td>
                      <td className="py-3">{set.status}</td>
                      <td className="py-3">{set.level}</td>
                      <td className="py-3 text-right">{set.sentenceCount ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>아직 등록된 세트가 없습니다. 세트 관리에서 초안을 만들 수 있습니다.</EmptyState>
          )}
        </div>

        <div className={panelClass}>
          <h2 className="text-lg font-bold">발행 전 확인</h2>
          <ul className="mt-3 space-y-3 text-sm leading-6 text-[#52685d]">
            <li>초안 세트는 문장 버전을 선택한 뒤 검토 상태로 보낼 수 있습니다.</li>
            <li>발행된 세트는 직접 수정하지 않고 복제해서 새 초안을 만듭니다.</li>
            <li>문장 수정은 기존 버전을 바꾸지 않고 새 불변 버전을 생성합니다.</li>
            <li>오디오는 비공개 저장소 서명 업로드 완료 후 문장에 연결합니다.</li>
          </ul>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={panelClass}>
      <p className="text-sm font-bold text-[#52685d]">{label}</p>
      <p className="mt-2 text-3xl font-bold text-[#245d45]">{value}</p>
    </div>
  );
}
