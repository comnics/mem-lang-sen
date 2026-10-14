import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { preferenceInputSchema, updateSentencePreference } from '@/server/services/records';

export const PATCH = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, preferenceInputSchema);
  return Response.json(await updateSentencePreference(user.id, body));
});
