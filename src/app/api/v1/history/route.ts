import { requireUser } from '@/server/auth';
import { api } from '@/server/http';
import { getHistory } from '@/server/services/learning';

export const GET = api(async () => {
  const user = await requireUser();
  return Response.json(await getHistory(user.id));
});
