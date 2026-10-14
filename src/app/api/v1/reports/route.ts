import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { createContentReport, reportInputSchema } from '@/server/services/records';

export const POST = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, reportInputSchema);
  return Response.json(await createContentReport(user.id, body));
});
