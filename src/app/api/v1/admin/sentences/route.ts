import { requireAdmin } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { adminCreateSentence, adminListSentences, sentenceInputSchema } from '@/server/services/content';

export const GET = api(async () => {
  await requireAdmin();
  return Response.json(await adminListSentences());
});

export const POST = api(async (request) => {
  await requireAdmin();
  const body = await jsonBody(request, sentenceInputSchema);
  return Response.json(await adminCreateSentence(body));
});
