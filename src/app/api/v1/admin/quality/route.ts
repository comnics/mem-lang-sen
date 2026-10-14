import { requireAdmin } from '@/server/auth';
import { api } from '@/server/http';
import { getQualityMetrics } from '@/server/services/records';

export const GET = api(async () => {
  await requireAdmin();
  return Response.json(await getQualityMetrics());
});
