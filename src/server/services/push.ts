import 'server-only';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import webpush, { type PushSubscription as WebPushSubscription, type WebPushError } from 'web-push';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { dateStart, localDate, nextStudyAt } from '@/domain/scheduling';
import { completeStudyPlanSchema } from '@/domain/study-plan';
import { db } from '@/server/db';
import { HttpError } from '@/server/http';
import { getTodayQueue } from './scheduling';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_DEVICES = 10;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 60_000;
const DISPATCH_BATCH_LIMIT = 5;
const CURSOR_NAME = 'notification-schedule-v1';

export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(80).max(120).regex(BASE64URL_RE),
    auth: z.string().min(16).max(64).regex(BASE64URL_RE),
  }),
});

const preferencePatchSchema = z.object({
  enabled: z.boolean().optional(),
  quietStart: z.string().regex(TIME_RE).optional(),
  quietEnd: z.string().regex(TIME_RE).optional(),
}).refine((value) => Object.keys(value).length > 0, '변경할 설정이 없습니다.');

export type PushPreferencePatch = z.infer<typeof preferencePatchSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;
export type PushSettingsDTO = {
  enabled: boolean;
  publicKey: string | null;
  configured: boolean;
  quietStart: string;
  quietEnd: string;
  subscriptions: { id: string; endpoint: string; enabled: boolean; createdAt: string }[];
};
export type PushRuntimeConfig = {
  enabled: boolean;
  publicKey: string | null;
  privateKey: string | null;
  subject: string;
};
export type PushSender = (subscription: WebPushSubscription, payload: string, options: { ttl: number; timeout: number }) => Promise<void>;

type DeliveryRow = {
  id: string;
  subscriptionId: string;
  userId: string;
  deliveryKey: string;
  attempts: number;
  expiresAt: Date;
  leaseToken: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function getPushRuntimeConfig(env: Record<string, string | undefined> = process.env): PushRuntimeConfig {
  const appEnv = env.APP_ENV;
  const enabled =
    env.PUSH_ENABLED === 'true' &&
    (appEnv === 'production' || appEnv === 'staging') &&
    env.VERCEL_ENV !== 'preview' &&
    Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

  return {
    enabled,
    publicKey: env.VAPID_PUBLIC_KEY ?? null,
    privateKey: env.VAPID_PRIVATE_KEY ?? null,
    subject: env.VAPID_SUBJECT ?? fallbackVapidSubject(env),
  };
}

export function stagingUserAllowlist(env: Record<string, string | undefined> = process.env): string[] {
  return (env.PUSH_STAGING_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  if (isPrivateHostname(url.hostname)) return false;

  const host = url.hostname.toLowerCase();
  return (
    host === 'fcm.googleapis.com' ||
    host === 'android.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    host === 'updates-autopush.stage.mozaws.net' ||
    host === 'webpush.apple.com' ||
    host.endsWith('.push.apple.com') ||
    host.endsWith('.notify.windows.com')
  );
}

export async function getPushSettings(userId: string): Promise<PushSettingsDTO> {
  const [preference, subscriptions] = await Promise.all([
    db.notificationPreference.findUnique({ where: { userId } }),
    db.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const config = getPushRuntimeConfig();

  return {
    enabled: preference?.enabled ?? false,
    publicKey: config.publicKey,
    configured: config.enabled,
    quietStart: preference?.quietStart ?? '22:00',
    quietEnd: preference?.quietEnd ?? '08:00',
    subscriptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      endpoint: subscription.endpoint,
      enabled: subscription.enabled,
      createdAt: subscription.createdAt.toISOString(),
    })),
  };
}

export async function savePushSubscription(userId: string, input: PushSubscriptionInput) {
  const parsed = pushSubscriptionInputSchema.parse(input);
  if (!isAllowedPushEndpoint(parsed.endpoint)) throw new HttpError(400, '지원하지 않는 푸시 제공자입니다.');

  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.pushSubscription.findUnique({ where: { endpoint: parsed.endpoint } });
    if (existing && existing.userId !== userId) throw new HttpError(409, '이미 다른 계정에 등록된 기기입니다.');

    if (!existing) {
      const count = await tx.pushSubscription.count({ where: { userId } });
      if (count >= MAX_DEVICES) throw new HttpError(409, '등록 가능한 기기 수를 초과했습니다.');
    }

    await tx.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    const subscription = existing
      ? await tx.pushSubscription.update({
        where: { endpoint: parsed.endpoint },
        data: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth, enabled: true },
      })
      : await tx.pushSubscription.create({
        data: { userId, endpoint: parsed.endpoint, p256dh: parsed.keys.p256dh, auth: parsed.keys.auth },
      });

    return { ok: true, id: subscription.id };
  });
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
  return { ok: true };
}

export async function updatePushPreference(userId: string, patch: PushPreferencePatch) {
  const parsed = preferencePatchSchema.parse(patch);
  const current = await db.notificationPreference.findUnique({ where: { userId } });
  const data = {
    enabled: parsed.enabled ?? current?.enabled ?? false,
    quietStart: parsed.quietStart ?? current?.quietStart ?? '22:00',
    quietEnd: parsed.quietEnd ?? current?.quietEnd ?? '08:00',
  };

  await db.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return { ok: true };
}

export async function scheduleDueNotifications(now = new Date(), limit = 50) {
  const config = getPushRuntimeConfig();
  if (!config.enabled) return { scanned: 0, created: 0, disabled: true };

  const candidates = await nextNotificationCandidates(limit);
  let created = 0;
  for (const candidate of candidates) {
    created += await scheduleForUser(candidate.userId, now);
  }
  await advanceCursor(candidates.at(-1)?.userId ?? null);
  return { scanned: candidates.length, created, disabled: false };
}

export async function dispatchNotificationBatch(options: { now?: Date; limit?: number; sender?: PushSender; clock?: () => Date } = {}) {
  const now = options.now ?? new Date();
  const clock = options.clock ?? (() => new Date());
  const config = getPushRuntimeConfig();
  if (!config.enabled) return { scanned: 0, sent: 0, failed: 0, disabled: true };
  if (!config.publicKey || !config.privateKey) return { scanned: 0, sent: 0, failed: 0, disabled: true };

  const run = await db.jobRun.create({ data: { status: 'RUNNING' } });
  const sender = options.sender ?? createWebPushSender(config);
  let sent = 0;
  let failed = 0;

  try {
    const deliveries = await claimDeliveries(now, Math.min(options.limit ?? DISPATCH_BATCH_LIMIT, DISPATCH_BATCH_LIMIT));
    for (const delivery of deliveries) {
      const sendNow = clock();
      const validation = await validateDeliveryForSend(delivery, sendNow);
      if (!validation.ok) {
        await cancelDelivery(delivery.id, delivery.leaseToken, validation.reason);
        continue;
      }

      const payload = JSON.stringify({
        title: '오늘 외울 문장이 준비됐어요',
        body: '복습과 새 문장을 확인하세요.',
        url: '/today',
        tag: delivery.deliveryKey.split(':').at(-1) ?? 'today',
      });
      try {
        await sender(toWebPushSubscription(delivery), payload, { ttl: ttlFor(delivery.expiresAt, sendNow), timeout: SEND_TIMEOUT_MS });
        const updated = await markDeliverySent(delivery.id, delivery.leaseToken, sendNow);
        if (updated) sent += 1;
      } catch (error) {
        failed += 1;
        await markDeliveryFailed(delivery, error, sendNow);
      }
    }

    await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: 'SUCCEEDED', scanned: deliveries.length, sent, failed } });
    return { scanned: deliveries.length, sent, failed, disabled: false };
  } catch (error) {
    await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: 'FAILED', sent, failed } }).catch(() => undefined);
    throw error;
  }
}

export function verifyJobBearer(request: Request, secret = process.env.JOB_TRIGGER_SECRET): boolean {
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const supplied = header.slice(prefix.length);
  const left = createHash('sha256').update(supplied).digest();
  const right = createHash('sha256').update(secret).digest();
  return timingSafeEqual(left, right);
}

async function nextNotificationCandidates(limit: number) {
  const cursor = await db.jobCursor.findUnique({ where: { name: CURSOR_NAME } });
  const afterCursor = cursor?.lastUserId
    ? await findCandidateUsers(limit, { gt: cursor.lastUserId })
    : await findCandidateUsers(limit);
  return afterCursor.length ? afterCursor : findCandidateUsers(limit);
}

async function findCandidateUsers(limit: number, id?: { gt: string }) {
  const allowedIds = process.env.APP_ENV === 'staging' ? stagingUserAllowlist() : [];
  const idFilter = process.env.APP_ENV === 'staging'
    ? { ...(id ?? {}), in: allowedIds.length ? allowedIds : ['00000000-0000-0000-0000-000000000000'] }
    : id;
  return db.appUser.findMany({
    where: {
      id: idFilter,
      status: 'ACTIVE',
      notificationPreference: { is: { enabled: true } },
      studyPlan: { isNot: null },
      pushSubscriptions: { some: { enabled: true } },
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true },
  }).then((users) => users.map((user) => ({ userId: user.id })));
}

async function advanceCursor(lastUserId: string | null) {
  await db.jobCursor.upsert({
    where: { name: CURSOR_NAME },
    create: { name: CURSOR_NAME, lastUserId },
    update: { lastUserId },
  });
}

async function scheduleForUser(userId: string, now: Date) {
  const planRow = await db.studyPlan.findUnique({ where: { userId }, include: { exceptions: true } });
  if (!planRow) return 0;
  const plan = completeStudyPlanSchema.parse(planRow);
  if (plan.paused) return 0;
  if (isQuietNow(now, plan.timezone, await getPreference(userId))) return 0;

  const today = localDate(now, plan.timezone);
  const scheduledAt = nextStudyAt(dateStart(today, plan.timezone), plan);
  if (!scheduledAt || scheduledAt > now || now.getTime() - scheduledAt.getTime() > TWO_HOURS_MS) return 0;

  const [written, spoken, subscriptions] = await Promise.all([
    getTodayQueue(userId, 'WRITTEN', now),
    getTodayQueue(userId, 'SPOKEN', now),
    db.pushSubscription.findMany({ where: { userId, enabled: true } }),
  ]);
  if (!written.items.length && !spoken.items.length && !written.activeSessionId && !spoken.activeSessionId) return 0;

  let created = 0;
  const expiresAt = new Date(scheduledAt.getTime() + TWO_HOURS_MS);
  for (const subscription of subscriptions) {
    const deliveryKey = `${subscription.id}:${today}`;
    const result = await db.notificationDelivery.createMany({
      data: [{ subscriptionId: subscription.id, deliveryKey, scheduledAt, expiresAt, nextAttemptAt: now }],
      skipDuplicates: true,
    });
    created += result.count;
  }
  return created;
}

async function getPreference(userId: string) {
  return db.notificationPreference.findUnique({ where: { userId } }).then((preference) => ({
    quietStart: preference?.quietStart ?? '22:00',
    quietEnd: preference?.quietEnd ?? '08:00',
  }));
}

function isQuietNow(now: Date, timezone: string, preference: { quietStart: string; quietEnd: string }) {
  const minutes = localMinutes(now, timezone);
  const start = parseMinutes(preference.quietStart);
  const end = parseMinutes(preference.quietEnd);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

async function claimDeliveries(now: Date, limit: number) {
  const token = randomUUID();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const rows = await db.$transaction(async (tx) => {
    await tx.notificationDelivery.updateMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        OR: [{ expiresAt: { lte: now } }, { attempts: { gte: MAX_ATTEMPTS } }],
      },
      data: { status: 'CANCELLED', lastError: 'expired-or-exhausted' },
    });
    await tx.notificationDelivery.updateMany({
      where: {
        status: 'SENDING',
        leaseUntil: { lt: now },
        OR: [{ expiresAt: { lte: now } }, { attempts: { gte: MAX_ATTEMPTS } }],
      },
      data: { status: 'CANCELLED', leaseUntil: null, leaseToken: null, lastError: 'expired-or-exhausted' },
    });
    const claimed = await tx.$queryRaw<DeliveryRow[]>`
      WITH picked AS (
        SELECT d.id
        FROM app."NotificationDelivery" d
        JOIN app."PushSubscription" s ON s.id=d."subscriptionId"
        WHERE d.status IN ('PENDING','FAILED','SENDING')
          AND d."nextAttemptAt" <= ${now}
          AND d."expiresAt" > ${now}
          AND d.attempts < ${MAX_ATTEMPTS}
          AND (d."leaseUntil" IS NULL OR d."leaseUntil" < ${now})
          AND s.enabled=true
        ORDER BY d."nextAttemptAt" ASC, d.id ASC
        LIMIT ${limit}
        FOR UPDATE OF d SKIP LOCKED
      )
      UPDATE app."NotificationDelivery" d
      SET status='SENDING', "leaseUntil"=${leaseUntil}, "leaseToken"=${token}, attempts=d.attempts+1
      FROM picked, app."PushSubscription" s
      WHERE d.id=picked.id AND s.id=d."subscriptionId"
      RETURNING d.id,d."subscriptionId",s."userId",d."deliveryKey",d.attempts,d."expiresAt",d."leaseToken",s.endpoint,s.p256dh,s.auth
    `;
    return claimed;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return rows;
}

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM app."AppUser" WHERE id=${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(401, '로그인이 필요합니다.');
}

function createWebPushSender(config: PushRuntimeConfig): PushSender {
  webpush.setVapidDetails(config.subject, config.publicKey!, config.privateKey!);
  return async (subscription, payload, options) => {
    await webpush.sendNotification(subscription, payload, { TTL: options.ttl, urgency: 'normal', timeout: options.timeout });
  };
}

function toWebPushSubscription(delivery: DeliveryRow): WebPushSubscription {
  return { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } };
}

async function markDeliverySent(id: string, leaseToken: string | null, now: Date) {
  if (!leaseToken) return false;
  const result = await db.notificationDelivery.updateMany({
    where: { id, leaseToken, status: 'SENDING' },
    data: { status: 'SENT', sentAt: now, leaseUntil: null, leaseToken: null, lastError: null },
  });
  return result.count === 1;
}

async function markDeliveryFailed(delivery: DeliveryRow & { leaseToken: string | null }, error: unknown, now: Date) {
  const statusCode = typeof (error as WebPushError).statusCode === 'number' ? (error as WebPushError).statusCode : undefined;
  if (statusCode === 404 || statusCode === 410) {
    await db.pushSubscription.updateMany({ where: { endpoint: delivery.endpoint }, data: { enabled: false } });
    await db.notificationDelivery.updateMany({
      where: { id: delivery.id, leaseToken: delivery.leaseToken, status: 'SENDING' },
      data: { status: 'CANCELLED', leaseUntil: null, leaseToken: null, lastError: `push-${statusCode}` },
    });
    return;
  }

  const attempts = delivery.attempts;
  const retryable = statusCode === undefined || statusCode === 429 || statusCode >= 500;
  await db.notificationDelivery.updateMany({
    where: { id: delivery.id, leaseToken: delivery.leaseToken, status: 'SENDING' },
    data: {
      status: retryable && attempts < MAX_ATTEMPTS ? 'FAILED' : 'CANCELLED',
      leaseUntil: null,
      leaseToken: null,
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
      lastError: statusCode ? `push-${statusCode}` : safeError(error),
    },
  });
}

async function validateDeliveryForSend(delivery: DeliveryRow, now: Date): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (delivery.expiresAt <= now) return { ok: false, reason: 'expired' };
  if (process.env.APP_ENV === 'staging' && !stagingUserAllowlist().includes(delivery.userId)) return { ok: false, reason: 'staging-not-allowed' };

  const [subscription, planRow, preference] = await Promise.all([
    db.pushSubscription.findUnique({ where: { id: delivery.subscriptionId }, include: { user: { select: { status: true } } } }),
    db.studyPlan.findUnique({ where: { userId: delivery.userId }, include: { exceptions: true } }),
    db.notificationPreference.findUnique({ where: { userId: delivery.userId } }),
  ]);
  if (!subscription?.enabled) return { ok: false, reason: 'subscription-disabled' };
  if (subscription.user.status !== 'ACTIVE') return { ok: false, reason: 'user-inactive' };
  if (!preference?.enabled) return { ok: false, reason: 'preference-disabled' };
  if (!planRow) return { ok: false, reason: 'plan-missing' };

  const plan = completeStudyPlanSchema.parse(planRow);
  if (plan.paused) return { ok: false, reason: 'plan-paused' };
  if (isQuietNow(now, plan.timezone, preference)) return { ok: false, reason: 'quiet-hours' };

  const [written, spoken] = await Promise.all([
    getTodayQueue(delivery.userId, 'WRITTEN', now),
    getTodayQueue(delivery.userId, 'SPOKEN', now),
  ]);
  if (!written.items.length && !spoken.items.length && !written.activeSessionId && !spoken.activeSessionId) return { ok: false, reason: 'no-current-work' };
  return { ok: true };
}

async function cancelDelivery(id: string, leaseToken: string | null, reason: string) {
  await db.notificationDelivery.updateMany({
    where: { id, leaseToken, status: 'SENDING' },
    data: { status: 'CANCELLED', leaseUntil: null, leaseToken: null, lastError: reason },
  });
}

function ttlFor(expiresAt: Date, now: Date) {
  return Math.max(0, Math.min(7200, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)));
}

function retryDelayMs(attempts: number) {
  return Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attempts - 1)));
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.name || 'Error';
  return 'UnknownError';
}

function fallbackVapidSubject(env: Record<string, string | undefined>) {
  if (env.APP_ORIGIN) return `mailto:admin@${new URL(env.APP_ORIGIN).hostname}`;
  return 'mailto:admin@example.com';
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host === '::1') return true;
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!ipv4) return false;
  const [, aRaw, bRaw] = ipv4;
  const a = Number(aRaw);
  const b = Number(bRaw);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function parseMinutes(value: string) {
  const [, hour, minute] = TIME_RE.exec(value) ?? [];
  return Number(hour) * 60 + Number(minute);
}

function localMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return Number(values.get('hour')) * 60 + Number(values.get('minute'));
}
