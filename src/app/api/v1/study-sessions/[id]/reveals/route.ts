import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { revealSessionItem } from '@/server/services/learning';

const schema = z.object({ itemId: z.string().cuid(), kind: z.enum(['HINT', 'ANSWER']) });

export const POST = api(async (request, context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await jsonBody(request, schema);
  return Response.json(await revealSessionItem(user.id, id, body));
});
