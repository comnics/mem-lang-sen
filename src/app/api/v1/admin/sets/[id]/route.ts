import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { adminUpdateSet, setInputSchema } from '@/server/services/content';

const schema = z.union([setInputSchema, z.object({ status: z.literal('ARCHIVED') })]);

export const PATCH = api(async (request, context) => {
  await requireAdmin();
  const { id } = await context.params;
  const body = await jsonBody(request, schema);
  return Response.json(await adminUpdateSet(id, body));
});
