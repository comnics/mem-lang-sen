import 'server-only';
import { dispatchNotificationBatch, scheduleDueNotifications, type PushSender } from '@/server/services/push';

export async function runNotificationDispatchJob(options: { now?: Date; scheduleLimit?: number; dispatchLimit?: number; sender?: PushSender; clock?: () => Date } = {}) {
  const now = options.now ?? new Date();
  const scheduled = await scheduleDueNotifications(now, options.scheduleLimit ?? 50);
  if (scheduled.disabled) return { scanned: 0, sent: 0, failed: 0, disabled: true };

  const dispatched = await dispatchNotificationBatch({ now, limit: options.dispatchLimit ?? 25, sender: options.sender, clock: options.clock });
  return {
    scanned: scheduled.scanned + dispatched.scanned,
    sent: dispatched.sent,
    failed: dispatched.failed,
    disabled: false,
  };
}
