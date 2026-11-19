import { api, jsonBody } from '@/server/http';
import { requireUser } from '@/server/auth';
import { assertPersonalCsrf } from '@/server/imports/csrf';
import { addPersonalSentences,addPersonalSentencesSchema } from '@/server/services/personal-content';
export const POST=api(async(request,context)=>{const user=await requireUser();await assertPersonalCsrf(request,user.id);return Response.json(await addPersonalSentences(user.id,(await context.params).id,await jsonBody(request,addPersonalSentencesSchema)),{status:201});});
