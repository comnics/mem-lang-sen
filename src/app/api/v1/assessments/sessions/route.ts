import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { createAssessmentSession } from '@/server/services/assessments';

const schema = z.object({ kind: z.enum(['WEEKLY', 'RETENTION']) });

export const POST = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, schema);
  return Response.json(await createAssessmentSession(user.id, body));
});
