import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

config({ path: '.env.local', quiet: true });

type Db = typeof import('@/server/db')['db'];
type PushServices = typeof import('@/server/services/push');

let db: Db;
let push: PushServices;

const runId = randomUUID();
const createdUserIds = new Set<string>();
const createdSetIds = new Set<string>();
const createdSentenceIds = new Set<string>();

describe('push notification integration', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required. Run pnpm local:setup before integration tests.');
    const hostname = new URL(databaseUrl).hostname;
    if (!['127.0.0.1', 'localhost'].includes(hostname)) {
      throw new Error(`Refusing to run integration tests against non-local database host: ${hostname}`);
    }

    process.env.PUSH_ENABLED = 'true';
    process.env.APP_ENV = 'staging';
    process.env.VERCEL_ENV = 'production';
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';
    process.env.JOB_TRIGGER_SECRET = 'j'.repeat(32);

    ({ db } = await import('@/server/db'));
    push = await import('@/server/services/push');
    await db.$queryRaw`select 1`;
  });

  beforeEach(async () => {
    await db.notificationDelivery.deleteMany({ where: { subscription: { userId: { in: [...createdUserIds] } } } });
  });

  afterAll(async () => {
    if (!db) return;
    await db.appUser.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    await db.setSentence.deleteMany({ where: { setId: { in: [...createdSetIds] } } });
    await db.studySet.deleteMany({ where: { id: { in: [...createdSetIds] } } });
    await db.sentenceVersion.deleteMany({ where: { sentenceId: { in: [...createdSentenceIds] } } });
    await db.sentence.deleteMany({ where: { id: { in: [...createdSentenceIds] } } });
    await db.$disconnect();
  });

  it('registers a subscription, preference, and one daily delivery when today has work', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    const user = await createUser('schedule');
    await createPublishedLearningSet(user.id, 'schedule');
    await configurePlan(user.id, now);

    await push.savePushSubscription(user.id, {
      endpoint: endpointFor('schedule'),
      keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
    });
    await push.updatePushPreference(user.id, { enabled: true, quietStart: '22:00', quietEnd: '08:00' });

    const first = await push.scheduleDueNotifications(now, 20);
    const second = await push.scheduleDueNotifications(now, 20);
    const deliveries = await db.notificationDelivery.findMany({ where: { subscription: { userId: user.id } } });

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
  });

  it('serializes concurrent subscription saves to the ten-device cap', async () => {
    const user = await createUser('device-cap');
    const results = await Promise.allSettled(Array.from({ length: 11 }, (_, index) => push.savePushSubscription(user.id, {
      endpoint: endpointFor(`device-cap-${index}`),
      keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
    })));
    const count = await db.pushSubscription.count({ where: { userId: user.id } });

    expect(count).toBe(10);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('skips scheduling during quiet hours', async () => {
    const now = new Date('2026-10-14T14:10:00.000Z');
    const user = await createUser('quiet');
    await createPublishedLearningSet(user.id, 'quiet');
    await configurePlan(user.id, now, '23:00');
    await createSubscription(user.id, 'quiet');
    await push.updatePushPreference(user.id, { enabled: true, quietStart: '22:00', quietEnd: '08:00' });

    const result = await push.scheduleDueNotifications(now, 20);
    const count = await db.notificationDelivery.count({ where: { subscription: { userId: user.id } } });

    expect(result.created).toBe(0);
    expect(count).toBe(0);
  });

  it('sends claimed deliveries with an injected sender and records a job run', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    const user = await createUser('dispatch');
    await createPublishedLearningSet(user.id, 'dispatch');
    await configurePlan(user.id, now);
    const subscription = await createSubscription(user.id, 'dispatch');
    await createDelivery(subscription.id, now);

    const sentEndpoints: string[] = [];
    const result = await push.dispatchNotificationBatch({
      now,
      clock: () => now,
      sender: async (subscriptionInput, _payload, options) => {
        sentEndpoints.push(subscriptionInput.endpoint);
        expect(options).toMatchObject({ ttl: 60, timeout: 8000 });
      },
    });
    const delivery = await db.notificationDelivery.findUniqueOrThrow({ where: { deliveryKey: `${subscription.id}:2026-10-14` } });
    const job = await db.jobRun.findFirstOrThrow({ orderBy: { startedAt: 'desc' } });

    expect(result).toMatchObject({ scanned: 1, sent: 1, failed: 0 });
    expect(sentEndpoints).toEqual([subscription.endpoint]);
    expect(delivery).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(delivery.sentAt?.toISOString()).toBe(now.toISOString());
    expect(job).toMatchObject({ status: 'SUCCEEDED', scanned: 1, sent: 1, failed: 0 });
  });

  it('disables expired provider subscriptions on 410 responses', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    const user = await createUser('gone');
    await createPublishedLearningSet(user.id, 'gone');
    await configurePlan(user.id, now);
    const subscription = await createSubscription(user.id, 'gone');
    await createDelivery(subscription.id, now);

    await push.dispatchNotificationBatch({
      now,
      clock: () => now,
      sender: async () => {
        const error = new Error('gone') as Error & { statusCode: number };
        error.statusCode = 410;
        throw error;
      },
    });
    const stored = await db.pushSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    const delivery = await db.notificationDelivery.findUniqueOrThrow({ where: { deliveryKey: `${subscription.id}:2026-10-14` } });

    expect(stored.enabled).toBe(false);
    expect(delivery).toMatchObject({ status: 'CANCELLED', lastError: 'push-410' });
  });

  it('claims one delivery once across concurrent dispatch ticks', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    const user = await createUser('concurrent');
    await createPublishedLearningSet(user.id, 'concurrent');
    await configurePlan(user.id, now);
    const subscription = await createSubscription(user.id, 'concurrent');
    await createDelivery(subscription.id, now);

    const results = await Promise.all([
      push.dispatchNotificationBatch({ now, clock: () => now, sender: async () => undefined }),
      push.dispatchNotificationBatch({ now, clock: () => now, sender: async () => undefined }),
    ]);
    const delivery = await db.notificationDelivery.findUniqueOrThrow({ where: { deliveryKey: `${subscription.id}:2026-10-14` } });

    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.scanned, 0)).toBe(1);
    expect(delivery.status).toBe('SENT');
  });

  it('recovers expired SENDING leases and protects final writes with the current token', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    const user = await createUser('lease-recover');
    await createPublishedLearningSet(user.id, 'lease-recover');
    await configurePlan(user.id, now);
    const subscription = await createSubscription(user.id, 'lease-recover');
    await createDelivery(subscription.id, now, { status: 'SENDING', leaseUntil: new Date(now.getTime() - 1000), leaseToken: 'old-token', attempts: 1 });

    const result = await push.dispatchNotificationBatch({ now, clock: () => now, sender: async () => undefined });
    const delivery = await db.notificationDelivery.findUniqueOrThrow({ where: { deliveryKey: `${subscription.id}:2026-10-14` } });

    expect(result).toMatchObject({ scanned: 1, sent: 1, failed: 0 });
    expect(delivery).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('does not mark sent when another worker replaces the lease token before final write', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    const user = await createUser('stale-token');
    await createPublishedLearningSet(user.id, 'stale-token');
    await configurePlan(user.id, now);
    const subscription = await createSubscription(user.id, 'stale-token');
    await createDelivery(subscription.id, now);

    const result = await push.dispatchNotificationBatch({
      now,
      clock: () => now,
      sender: async () => {
        await db.notificationDelivery.update({ where: { deliveryKey: `${subscription.id}:2026-10-14` }, data: { leaseToken: 'new-token' } });
      },
    });
    const delivery = await db.notificationDelivery.findUniqueOrThrow({ where: { deliveryKey: `${subscription.id}:2026-10-14` } });

    expect(result).toMatchObject({ scanned: 1, sent: 0, failed: 0 });
    expect(delivery).toMatchObject({ status: 'SENDING', leaseToken: 'new-token' });
    expect(delivery.sentAt).toBeNull();
  });

  it('retries 429 and network failures with capped backoff state', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    const rateLimited = await createReadyDelivery('rate-limited', now);
    const network = await createReadyDelivery('network-failure', now);

    await push.dispatchNotificationBatch({
      now,
      clock: () => now,
      limit: 1,
      sender: async () => {
        const error = new Error('rate limited') as Error & { statusCode: number };
        error.statusCode = 429;
        throw error;
      },
    });
    await push.dispatchNotificationBatch({
      now,
      clock: () => now,
      limit: 1,
      sender: async () => {
        throw new Error('network');
      },
    });

    const first = await db.notificationDelivery.findUniqueOrThrow({ where: { deliveryKey: `${rateLimited.subscription.id}:2026-10-14` } });
    const second = await db.notificationDelivery.findUniqueOrThrow({ where: { deliveryKey: `${network.subscription.id}:2026-10-14` } });
    expect(first).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'push-429' });
    expect(second).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'Error' });
    expect(first.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    expect(second.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('caps each dispatch batch at five sends', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    for (let index = 0; index < 6; index += 1) await createReadyDelivery(`cap-${index}`, now);

    const result = await push.dispatchNotificationBatch({ now, limit: 25, clock: () => now, sender: async () => undefined });
    const pending = await db.notificationDelivery.count({ where: { status: 'PENDING', subscription: { userId: { in: [...createdUserIds] } } } });

    expect(result).toMatchObject({ scanned: 5, sent: 5 });
    expect(pending).toBe(1);
  });

  it('cancels stale deliveries before network send', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    const expired = await createReadyDelivery('expired', now, { expiresAt: new Date(now.getTime() - 1000) });
    const quiet = await createReadyDelivery('quiet-current', now);
    await push.updatePushPreference(quiet.user.id, { enabled: true, quietStart: '09:00', quietEnd: '10:00' });
    const prefOff = await createReadyDelivery('pref-off', now);
    await push.updatePushPreference(prefOff.user.id, { enabled: false });
    const notAllowed = await createReadyDelivery('staging-deny', now);
    process.env.PUSH_STAGING_USER_IDS = [...createdUserIds].filter((id) => id !== notAllowed.user.id).join(',');
    let sends = 0;

    await push.dispatchNotificationBatch({ now, limit: 5, clock: () => now, sender: async () => { sends += 1; } });
    const rows = await db.notificationDelivery.findMany({ where: { id: { in: [expired.delivery.id, quiet.delivery.id, prefOff.delivery.id, notAllowed.delivery.id] } } });
    const statusById = new Map(rows.map((row) => [row.id, row]));

    expect(sends).toBe(0);
    expect(statusById.get(expired.delivery.id)).toMatchObject({ status: 'CANCELLED', lastError: 'expired-or-exhausted' });
    expect(statusById.get(quiet.delivery.id)).toMatchObject({ status: 'CANCELLED', lastError: 'quiet-hours' });
    expect(statusById.get(prefOff.delivery.id)).toMatchObject({ status: 'CANCELLED', lastError: 'preference-disabled' });
    expect(statusById.get(notAllowed.delivery.id)).toMatchObject({ status: 'CANCELLED', lastError: 'staging-not-allowed' });
  });

  it('cancels expired or exhausted old sending leases so they do not stick forever', async () => {
    const now = new Date('2026-10-14T00:10:00.000Z');
    const expired = await createReadyDelivery('sending-expired-cleanup', now, {
      status: 'SENDING',
      leaseUntil: new Date(now.getTime() - 1000),
      leaseToken: 'expired-token',
      expiresAt: new Date(now.getTime() - 1000),
    });
    const exhausted = await createReadyDelivery('sending-exhausted-cleanup', now, {
      status: 'SENDING',
      leaseUntil: new Date(now.getTime() - 1000),
      leaseToken: 'exhausted-token',
      attempts: 5,
    });

    const result = await push.dispatchNotificationBatch({ now, clock: () => now, sender: async () => undefined });
    const rows = await db.notificationDelivery.findMany({ where: { id: { in: [expired.delivery.id, exhausted.delivery.id] } } });

    expect(result.scanned).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'CANCELLED' && row.leaseToken === null && row.leaseUntil === null)).toBe(true);
  });
});

async function createUser(slug: string) {
  const user = await db.appUser.create({
    data: { id: randomUUID(), email: `${slug}-${runId}@push.test`, displayName: slug, onboarded: true },
  });
  createdUserIds.add(user.id);
  process.env.PUSH_STAGING_USER_IDS = [...new Set([...(process.env.PUSH_STAGING_USER_IDS ?? '').split(',').filter(Boolean), user.id])].join(',');
  return user;
}

async function configurePlan(userId: string, now: Date, localTime = '09:00') {
  await db.studyPlan.create({
    data: {
      userId,
      displayName: 'Push learner',
      dailyMinutes: 5,
      timezone: 'Asia/Seoul',
      weekdays: [1, 2, 3, 4, 5],
      ruleType: 'WEEKDAYS',
      intervalDays: 2,
      anchorDate: '2026-10-14',
      startDate: '2026-10-14',
      localTime,
      createdAt: now,
    },
  });
}

async function createPublishedLearningSet(userId: string, slug: string) {
  const sentence = await db.sentence.create({ data: {} });
  createdSentenceIds.add(sentence.id);
  const version = await db.sentenceVersion.create({
    data: {
      sentenceId: sentence.id,
      versionNumber: 1,
      prompt: `Prompt ${slug}`,
      meaning: `Meaning ${slug}`,
      target: `Target ${slug}.`,
      acceptedAnswers: [`Target ${slug}.`],
      hint: `Hint ${slug}`,
      explanation: `Explanation ${slug}`,
      level: 'A1',
      status: 'PUBLISHED',
    },
  });
  const set = await db.studySet.create({
    data: { title: `Set ${slug}`, description: slug, category: 'SITUATION', level: 'A1', status: 'PUBLISHED', publishedAt: new Date() },
  });
  createdSetIds.add(set.id);
  await db.setSentence.create({ data: { setId: set.id, sentenceVersionId: version.id, order: 1 } });
  await db.enrollment.create({ data: { userId, setId: set.id } });
  return { set, sentence, version };
}

async function createSubscription(userId: string, slug: string) {
  await db.notificationPreference.upsert({
    where: { userId },
    create: { userId, enabled: true },
    update: { enabled: true },
  });
  return db.pushSubscription.create({
    data: { userId, endpoint: endpointFor(slug), p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
  });
}

function endpointFor(slug: string) {
  return `https://fcm.googleapis.com/fcm/send/${runId}-${slug}`;
}

async function createDelivery(subscriptionId: string, now: Date, overrides: Partial<{
  status: string;
  leaseUntil: Date | null;
  leaseToken: string | null;
  attempts: number;
  expiresAt: Date;
}> = {}) {
  return db.notificationDelivery.create({
    data: {
      subscriptionId,
      deliveryKey: `${subscriptionId}:2026-10-14`,
      scheduledAt: now,
      expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 60_000),
      nextAttemptAt: now,
      status: overrides.status ?? 'PENDING',
      attempts: overrides.attempts ?? 0,
      leaseUntil: overrides.leaseUntil,
      leaseToken: overrides.leaseToken,
    },
  });
}

async function createReadyDelivery(slug: string, now: Date, overrides: Parameters<typeof createDelivery>[2] = {}) {
  const user = await createUser(slug);
  await createPublishedLearningSet(user.id, slug);
  await configurePlan(user.id, now);
  const subscription = await createSubscription(user.id, slug);
  const delivery = await createDelivery(subscription.id, now, overrides);
  return { user, subscription, delivery };
}
