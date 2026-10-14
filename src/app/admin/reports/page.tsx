import { requirePageUser } from '@/server/auth';
import { getAdminReports } from '@/server/services/records';
import { ReportsClient } from '@/features/admin/reports-client';
import { PageHeader } from '@/features/admin/ui';

export default async function AdminReportsPage() {
  await requirePageUser(true);
  const reports = await getAdminReports();
  return (
    <>
      <PageHeader title="콘텐츠 신고" description="학습자가 신고한 오탈자, 정답, 음원, 의미 문제를 처리합니다." />
      <ReportsClient initialReports={reports} />
    </>
  );
}
