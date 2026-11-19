import { api, jsonBody } from '@/server/http';
import { requireUser } from '@/server/auth';
import { assertPersonalCsrf } from '@/server/imports/csrf';
import { getPersonalSet,updatePersonalSet,updatePersonalSetSchema } from '@/server/services/personal-content';
export const GET=api(async(_request,context)=>Response.json(await getPersonalSet((await requireUser()).id,(await context.params).id)));
export const PATCH=api(async(request,context)=>{const user=await requireUser();await assertPersonalCsrf(request,user.id);return Response.json(await updatePersonalSet(user.id,(await context.params).id,await jsonBody(request,updatePersonalSetSchema)));});
