import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { deletePushSubscription, getPushSettings, pushSubscriptionInputSchema, savePushSubscription, updatePushPreference } from '@/server/services/push';

export const GET = api(async () => {
  const user = await requireUser();
  return Response.json(await getPushSettings(user.id));
});

export const POST = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, pushSubscriptionInputSchema);
  return Response.json(await savePushSubscription(user.id, body));
});

export const DELETE = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, z.object({ endpoint: z.string().url().max(2048) }));
  return Response.json(await deletePushSubscription(user.id, body.endpoint));
});

export const PATCH = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, z.object({
    enabled: z.boolean().optional(),
    quietStart: z.string().optional(),
    quietEnd: z.string().optional(),
  }));
  return Response.json(await updatePushPreference(user.id, body));
});
