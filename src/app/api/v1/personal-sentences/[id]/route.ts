import { api, jsonBody } from '@/server/http';
import { requireUser } from '@/server/auth';
import { assertPersonalCsrf } from '@/server/imports/csrf';
import { editPersonalSentence,editPersonalSentenceSchema } from '@/server/services/personal-content';
export const PATCH=api(async(request,context)=>{const user=await requireUser();await assertPersonalCsrf(request,user.id);return Response.json(await editPersonalSentence(user.id,(await context.params).id,await jsonBody(request,editPersonalSentenceSchema)));});
