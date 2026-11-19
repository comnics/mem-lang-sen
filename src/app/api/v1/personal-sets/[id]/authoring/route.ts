import { api } from '@/server/http';
import { requireUser } from '@/server/auth';
import { assertPersonalCsrf } from '@/server/imports/csrf';
import { exposePersonalSet } from '@/server/services/personal-content';
export const POST=api(async(request,context)=>{const user=await requireUser();await assertPersonalCsrf(request,user.id);return Response.json(await exposePersonalSet(user.id,(await context.params).id));});
