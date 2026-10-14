import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { createTodaySession, getTodayQueue } from '@/server/services/scheduling';
const modeSchema = z.enum(['WRITTEN', 'SPOKEN']);
export const GET = api(async (request) => {
  const user = await requireUser();
  const mode = modeSchema.parse(new URL(request.url).searchParams.get('mode') ?? 'WRITTEN');
  return Response.json(await getTodayQueue(user.id, mode));
});
export const POST = api(async (request) => {
  const user = await requireUser();
  const { mode } = await jsonBody(request, z.object({ mode: modeSchema }));
  return Response.json(await createTodaySession(user.id, mode));
});
