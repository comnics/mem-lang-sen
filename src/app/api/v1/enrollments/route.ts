import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { api, jsonBody } from '@/server/http';
import { enrollSet, unenrollSet, setEnrollmentPaused } from '@/server/services/learning';

const schema = z.object({ setId: z.string().cuid() });

export const POST = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, schema);
  await enrollSet(user.id, body.setId);
  return Response.json({ ok: true });
});

export const DELETE = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, schema);
  return Response.json(await unenrollSet(user.id, body.setId));
});

export const PATCH = api(async (request) => {
  const user = await requireUser();
  const body = await jsonBody(request, schema.extend({ paused: z.boolean() }));
  return Response.json(await setEnrollmentPaused(user.id, body.setId, body.paused));
});
