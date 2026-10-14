import { requireAdmin } from '@/server/auth';
import { api } from '@/server/http';
import { adminPublishSet } from '@/server/services/content';

export const POST = api(async (_request, context) => {
  await requireAdmin();
  const { id } = await context.params;
  return Response.json(await adminPublishSet(id));
});
