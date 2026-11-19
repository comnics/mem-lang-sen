import { api, jsonBody } from '@/server/http';
import { requireUser } from '@/server/auth';
import { assertPersonalCsrf } from '@/server/imports/csrf';
import { editPersonalPreview,editPersonalPreviewSchema } from '@/server/services/personal-imports';
export const PATCH=api(async(request,context)=>{const user=await requireUser();await assertPersonalCsrf(request,user.id);const {id,importId}=await context.params;return Response.json(await editPersonalPreview(user.id,id,importId,await jsonBody(request,editPersonalPreviewSchema)));});
