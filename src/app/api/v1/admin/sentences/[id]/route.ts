import { requireAdmin } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { adminUpdateSentence, sentenceInputSchema } from '@/server/services/content';

export const PATCH = api(async (request, context) => {
  await requireAdmin();
  const { id } = await context.params;
  const body = await jsonBody(request, sentenceInputSchema);
  return Response.json(await adminUpdateSentence(id, body));
});
