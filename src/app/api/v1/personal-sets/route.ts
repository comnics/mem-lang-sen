import { api, jsonBody } from '@/server/http';
import { requireUser } from '@/server/auth';
import { assertPersonalCsrf } from '@/server/imports/csrf';
import { personalSetSchema } from '@/domain/personal-sentences';
import { listPersonalSets, createPersonalSet } from '@/server/services/personal-content';
export const GET=api(async()=>Response.json(await listPersonalSets((await requireUser()).id)));
export const POST=api(async(request)=>{const user=await requireUser();await assertPersonalCsrf(request,user.id);return Response.json(await createPersonalSet(user.id,await jsonBody(request,personalSetSchema)),{status:201});});
