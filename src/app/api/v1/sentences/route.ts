import { requireUser } from '@/server/auth';
import { api } from '@/server/http';
import { getMySentences } from '@/server/services/learning';

export const GET = api(async () => {
  const user = await requireUser();
  return Response.json(await getMySentences(user.id));
});
