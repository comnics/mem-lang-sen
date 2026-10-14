import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { completeAudioUpload, signAudioUpload } from '@/server/services/content';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('sign'),
    fileName: z.string().trim().min(1).max(180),
    contentType: z.string().trim().min(1).max(120),
    size: z.number().int().positive(),
  }),
  z.object({
    action: z.literal('complete'),
    id: z.string().cuid(),
  }),
]);

export const POST = api(async (request) => {
  await requireAdmin();
  const body = await jsonBody(request, schema);
  if (body.action === 'sign') return Response.json(await signAudioUpload(body));
  return Response.json(await completeAudioUpload(body.id));
});
