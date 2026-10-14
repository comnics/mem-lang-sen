import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { adminUpdateApplicationQuestion, applicationQuestionInputSchema } from '@/server/services/application-questions';

const schema = z.union([applicationQuestionInputSchema, z.object({ status: z.enum(['REVIEW', 'PUBLISHED', 'ARCHIVED']) })]);

export const PATCH = api(async (request, context) => {
  await requireAdmin();
  const { id } = await context.params;
  const body = await jsonBody(request, schema);
  return Response.json(await adminUpdateApplicationQuestion(id, body));
});
