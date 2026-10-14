import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { importSentences } from '@/server/services/content';

const schema = z.object({ csv: z.string().min(1).max(1024 * 1024), commit: z.boolean() });

export const POST = api(async (request) => {
  await requireAdmin();
  const body = await jsonBody(request, schema);
  return Response.json(await importSentences(body.csv, body.commit));
});
