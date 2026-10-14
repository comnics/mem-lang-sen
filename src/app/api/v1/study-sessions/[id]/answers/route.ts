import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { answerSessionItem } from '@/server/services/learning';

const schema = z.object({
  itemId: z.string().cuid(),
  eventId: z.string().uuid(),
  answer: z.string().trim().max(1000).optional(),
  selfRating: z.enum(['AGAIN', 'GOOD']).optional(),
  hard: z.boolean().optional(),
});

export const POST = api(async (request, context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await jsonBody(request, schema);
  return Response.json(await answerSessionItem(user.id, id, body));
});
