import { getCurrentUser } from '@/server/auth';
import { api } from '@/server/http';
import { getSet } from '@/server/services/content';

export const GET = api(async (_request, context) => {
  const user = await getCurrentUser();
  const { id } = await context.params;
  return Response.json(await getSet(id, user?.id));
});
