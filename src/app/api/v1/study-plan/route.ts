import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { studyPlanInputSchema } from '@/domain/study-plan';
import { getStudyPlan, updateStudyPlan } from '@/server/services/scheduling';

export const GET = api(async () => {
  const user = await requireUser();
  return Response.json(await getStudyPlan(user.id));
});
export const PUT = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, studyPlanInputSchema);
  return Response.json(await updateStudyPlan(user.id, body));
});
