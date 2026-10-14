import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { createAssessmentSession, getAssessments } from '@/server/services/assessments';

export const GET = api(async () => {
  const user = await requireUser();
  return Response.json(await getAssessments(user.id));
});

export const POST = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, z.object({ kind: z.enum(['WEEKLY', 'RETENTION']) }));
  return Response.json(await createAssessmentSession(user.id, body));
});
