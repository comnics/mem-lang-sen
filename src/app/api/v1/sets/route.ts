import { getCurrentUser } from '@/server/auth';
import { api } from '@/server/http';
import { listSets } from '@/server/services/content';

export const GET = api(async () => {
  const user = await getCurrentUser();
  return Response.json(await listSets(user?.id));
});
