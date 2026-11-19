import { api } from '@/server/http';
import { requireUser } from '@/server/auth';
import { issuePersonalCsrf } from '@/server/imports/csrf';
export const GET=api(async()=>Response.json(await issuePersonalCsrf((await requireUser()).id)));
