import { requireUser } from '@/server/auth';
import { api } from '@/server/http';
import { getSession } from '@/server/services/learning';

export const GET = api(async (_request, context) => {
  const user = await requireUser();
  const { id } = await context.params;
  return Response.json(await getSession(user.id, id));
});
