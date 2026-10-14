import { requirePageUser } from '@/server/auth';
import { getQualityMetrics } from '@/server/services/records';
import { QualityClient } from '@/features/admin/quality-client';
import { PageHeader } from '@/features/admin/ui';

export default async function AdminQualityPage() {
  await requirePageUser(true);
  const metrics = await getQualityMetrics();
  return (
    <>
      <PageHeader title="품질 지표" description="신고, 회상, 응용, 평가 결과를 분모와 함께 확인합니다." />
      <QualityClient metrics={metrics} />
    </>
  );
}
