import { requireAdmin } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { adminCreateApplicationQuestion, adminListApplicationQuestions, applicationQuestionInputSchema } from '@/server/services/application-questions';

export const GET = api(async () => {
  await requireAdmin();
  return Response.json(await adminListApplicationQuestions());
});

export const POST = api(async (request) => {
  await requireAdmin();
  const body = await jsonBody(request, applicationQuestionInputSchema);
  return Response.json(await adminCreateApplicationQuestion(body));
});
