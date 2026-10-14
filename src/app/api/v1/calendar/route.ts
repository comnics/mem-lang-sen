import { requireUser } from '@/server/auth';
import { api } from '@/server/http';
import { getCalendarMonth } from '@/server/services/records';

export const GET = api(async (request) => {
  const user = await requireUser();
  const month = new URL(request.url).searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
  return Response.json(await getCalendarMonth(user.id, month));
});
