import { runNotificationDispatchJob } from '@/server/jobs/notifications';
import { verifyJobBearer } from '@/server/services/push';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!verifyJobBearer(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const result = await runNotificationDispatchJob();
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
