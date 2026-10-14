import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { createStudySession } from '@/server/services/learning';

const schema = z.object({ setId: z.string().cuid(), mode: z.enum(['WRITTEN', 'SPOKEN']) });

export const POST = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, schema);
  return Response.json(await createStudySession(user.id, body));
});
