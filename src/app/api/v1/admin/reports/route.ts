import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { getAdminReports, updateAdminReport } from '@/server/services/records';

export const GET = api(async () => {
  await requireAdmin();
  return Response.json(await getAdminReports());
});

export const PATCH = api(async (request) => {
  await requireAdmin();
  const body = await jsonBody(request, z.object({ id: z.string().cuid(), status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']), resolution: z.string().max(1000).optional() }));
  return Response.json(await updateAdminReport(body.id, body));
});
