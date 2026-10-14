import { describe, expect, it } from 'vitest';
import { getPushRuntimeConfig, isAllowedPushEndpoint, pushSubscriptionInputSchema, verifyJobBearer } from '@/server/services/push';

describe('push service safeguards', () => {
  it('fails closed unless push is explicitly enabled for production-like environments', () => {
    expect(getPushRuntimeConfig({}).enabled).toBe(false);
    expect(getPushRuntimeConfig({
      PUSH_ENABLED: 'true',
      APP_ENV: 'production',
      VERCEL_ENV: 'preview',
      VAPID_PUBLIC_KEY: 'public',
      VAPID_PRIVATE_KEY: 'private',
    }).enabled).toBe(false);
    expect(getPushRuntimeConfig({
      PUSH_ENABLED: 'true',
      APP_ENV: 'staging',
      VAPID_PUBLIC_KEY: 'public',
      VAPID_PRIVATE_KEY: 'private',
      VAPID_SUBJECT: 'mailto:test@example.com',
    }).enabled).toBe(true);
  });

  it('allows only known HTTPS browser push provider endpoints', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://webpush.apple.com/QABCD')).toBe(true);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://example.com/fcm/send/abc')).toBe(false);
  });

  it('validates web push keys with bounded base64url inputs', () => {
    const valid = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/device',
      keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
    };
    expect(pushSubscriptionInputSchema.safeParse(valid).success).toBe(true);
    expect(pushSubscriptionInputSchema.safeParse({ ...valid, keys: { ...valid.keys, p256dh: 'short' } }).success).toBe(false);
    expect(pushSubscriptionInputSchema.safeParse({ ...valid, keys: { ...valid.keys, auth: 'not/allowed' } }).success).toBe(false);
  });

  it('checks job bearer tokens without accepting short or missing secrets', () => {
    const secret = 's'.repeat(32);
    expect(verifyJobBearer(new Request('https://app.test/api/jobs/dispatch', { headers: { authorization: `Bearer ${secret}` } }), secret)).toBe(true);
    expect(verifyJobBearer(new Request('https://app.test/api/jobs/dispatch', { headers: { authorization: 'Bearer wrong' } }), secret)).toBe(false);
    expect(verifyJobBearer(new Request('https://app.test/api/jobs/dispatch', { headers: { authorization: 'Bearer short' } }), 'short')).toBe(false);
  });
});
