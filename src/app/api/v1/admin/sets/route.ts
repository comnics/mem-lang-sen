import { requireAdmin } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { adminCreateSet, adminListSets, setInputSchema } from '@/server/services/content';

export const GET = api(async () => {
  await requireAdmin();
  return Response.json(await adminListSets());
});

export const POST = api(async (request) => {
  await requireAdmin();
  const body = await jsonBody(request, setInputSchema);
  return Response.json(await adminCreateSet(body));
});
