import { api, jsonBody } from '@/server/http';
import { requireUser } from '@/server/auth';
import { assertPersonalCsrf } from '@/server/imports/csrf';
import { commitPersonalPreview,commitPersonalPreviewSchema } from '@/server/services/personal-imports';
export const POST=api(async(request,context)=>{const user=await requireUser();await assertPersonalCsrf(request,user.id);const {id,importId}=await context.params;return Response.json(await commitPersonalPreview(user.id,id,importId,await jsonBody(request,commitPersonalPreviewSchema)));});
