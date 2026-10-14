import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3100';
const localPassword = 'LocalStudy!2026';
const createdUsers: { id: string; email: string }[] = [];
const vapidPublicKey = 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

if (new URL(origin).hostname !== '127.0.0.1' || !process.env.DIRECT_URL || !['127.0.0.1', 'localhost'].includes(new URL(process.env.DIRECT_URL).hostname)) {
  throw new Error('E2E requires isolated local Supabase.');
}

test('service worker caches only public offline assets and falls back on navigation', async ({ page, context }) => {
  await page.goto('/login');
  const registrationReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    return true;
  });
  test.skip(!registrationReady, 'service workers are unavailable in this browser');

  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match('/offline.html')))).toBeTruthy();
  await page.request.get('/api/v1/dashboard').catch(() => null);
  expect(await page.evaluate(async () => Boolean(await caches.match('/api/v1/dashboard')))).toBe(false);
  expect(await page.evaluate(async () => Boolean(await caches.match('/login')))).toBe(false);

  await context.setOffline(true);
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '네트워크 연결이 필요합니다.' })).toBeVisible();
  await context.setOffline(false);
});

test('push controls handle unsupported and denied permissions without a server subscription', async ({ browser }) => {
  const deniedUser = await createLearner('pwa-denied');
  const deniedPage = await authenticatedPage(browser, deniedUser.email);
  let deniedPostCount = 0;
  await deniedPage.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
    Notification.requestPermission = async () => 'denied';
  });
  await deniedPage.route('**/api/v1/push-subscriptions', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: pushSettings() });
      return;
    }
    if (method === 'POST') deniedPostCount += 1;
    await route.fulfill({ status: 500, json: { error: 'unexpected subscription' } });
  });
  await deniedPage.goto('/settings');
  await deniedPage.getByRole('button', { name: '알림 켜기' }).click();
  await expect(deniedPage.getByText('알림 권한이 차단되어 있습니다.')).toBeVisible();
  expect(deniedPostCount).toBe(0);
  await deniedPage.context().close();

  const unsupportedUser = await createLearner('pwa-unsupported');
  const unsupportedPage = await authenticatedPage(browser, unsupportedUser.email);
  let unsupportedPostCount = 0;
  await unsupportedPage.addInitScript(() => {
    Reflect.deleteProperty(window, 'PushManager');
  });
  await unsupportedPage.route('**/api/v1/push-subscriptions', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: pushSettings() });
      return;
    }
    if (route.request().method() === 'POST') unsupportedPostCount += 1;
    await route.fulfill({ status: 500, json: { error: 'unexpected subscription' } });
  });
  await unsupportedPage.goto('/settings');
  await expect(unsupportedPage.getByText('이 브라우저에서는 푸시 알림을 쓸 수 없습니다.')).toBeVisible();
  await expect(unsupportedPage.getByRole('button', { name: '알림 켜기' })).toBeDisabled();
  expect(unsupportedPostCount).toBe(0);
  await unsupportedPage.context().close();
});

test('outbox retries the same committed event once after response loss and clears pending entries on logout', async ({ browser }) => {
  const learner = await createLearner('pwa-outbox');
  const page = await authenticatedPage(browser, learner.email);
  const db = new Client({ connectionString: process.env.DIRECT_URL });
  await db.connect();
  try {
    const set = await firstPublishedSet(db);
    const enrolled = await page.request.post('/api/v1/enrollments', { headers: { Origin: origin }, data: { setId: set.id } });
    expect(enrolled.ok()).toBeTruthy();
    const started = await page.request.post('/api/v1/study-sessions', { headers: { Origin: origin }, data: { setId: set.id, mode: 'WRITTEN' } });
    expect(started.ok()).toBeTruthy();
    const { id: sessionId } = await started.json() as { id: string };
    const { rows: [target] } = await db.query<{ itemId: string; answer: string }>(
      'SELECT si.id AS "itemId", sv.target AS answer FROM app."SessionItem" si JOIN app."SentenceVersion" sv ON sv.id=si."sentenceVersionId" WHERE si."sessionId"=$1 ORDER BY si.position LIMIT 1',
      [sessionId],
    );
    expect(target).toBeTruthy();

    let committedEventId = '';
    await page.goto(`/study/${sessionId}`);
    await page.getByLabel('내가 떠올린 영어 문장').fill(target.answer);
    await page.route('**/api/v1/study-sessions/*/answers', async (route) => {
      committedEventId = (route.request().postDataJSON() as { eventId: string }).eventId;
      await route.fetch();
      await route.abort('failed');
    }, { times: 1 });
    await page.getByRole('button', { name: '제출', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('저장 확인');
    await expect.poll(() => reviewEventCount(db, learner.id, committedEventId)).toBe(1);

    await page.reload();
    await expect(page.getByText('저장 확인 대기 중인 제출 1개')).toBeVisible();
    await page.getByRole('button', { name: '대기 제출 다시 전송' }).click();
    await expect(page.getByText('저장 확인 대기 중인 제출 1개')).toHaveCount(0);
    await page.getByRole('button', { name: '이전', exact: true }).click();
    await expect(page.getByText('정답으로 기록했어요', { exact: true })).toBeVisible();
    expect(await reviewEventCount(db, learner.id, committedEventId)).toBe(1);

    await page.evaluate(({ userId, sessionId }) => {
      sessionStorage.setItem(`mem-lang-sen:outbox:v1:${userId}:${sessionId}`, JSON.stringify([{ ownerId: userId, sessionId, createdAt: Date.now(), payload: { itemId: 'manual', eventId: crypto.randomUUID(), answer: 'pending' } }]));
    }, { userId: learner.id, sessionId: 'logout-pending' });
    await page.goto('/settings');
    await page.getByRole('button', { name: '로그아웃' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('mem-lang-sen:outbox:v1:')))).toEqual([]);
  } finally {
    await db.end();
    await page.context().close();
  }
});

test.afterAll(async () => {
  const db = new Client({ connectionString: process.env.DIRECT_URL });
  const platform = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  await db.connect();
  try {
    for (const user of createdUsers) {
      await db.query('DELETE FROM app."ReviewEvent" WHERE "userId"=$1', [user.id]);
      await db.query('DELETE FROM app."StudySession" WHERE "userId"=$1', [user.id]);
      await db.query('DELETE FROM app."Enrollment" WHERE "userId"=$1', [user.id]);
      await db.query('DELETE FROM app."StudyPlan" WHERE "userId"=$1', [user.id]);
      await db.query('DELETE FROM app."NotificationPreference" WHERE "userId"=$1', [user.id]);
      await db.query('DELETE FROM app."PushSubscription" WHERE "userId"=$1', [user.id]);
      await db.query('DELETE FROM app."AppUser" WHERE id=$1', [user.id]);
      await platform.auth.admin.deleteUser(user.id);
    }
  } finally {
    await db.end();
  }
});

async function createLearner(label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  const platform = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const { data, error } = await platform.auth.admin.createUser({ email, password: localPassword, email_confirm: true, user_metadata: { displayName: 'PWA 학습자' } });
  if (error || !data.user) throw error ?? new Error('Failed to create user');
  createdUsers.push({ id: data.user.id, email });
  const db = new Client({ connectionString: process.env.DIRECT_URL });
  await db.connect();
  try {
    await db.query('INSERT INTO app."AppUser" (id,email,"displayName",role,status,onboarded,"updatedAt") VALUES ($1,$2,$3,\'USER\',\'ACTIVE\',true,now())', [data.user.id, email, 'PWA 학습자']);
  } finally {
    await db.end();
  }
  return { id: data.user.id, email };
}

async function authenticatedPage(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await login(page, email);
  return page;
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(localPassword);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/(today|onboarding)$/);
}

async function firstPublishedSet(db: Client) {
  const { rows } = await db.query<{ id: string }>(
    'SELECT s.id FROM app."StudySet" s JOIN app."SetSentence" ss ON ss."setId"=s.id JOIN app."SentenceVersion" sv ON sv.id=ss."sentenceVersionId" WHERE s.status=\'PUBLISHED\' AND s.id LIKE \'cmemseedset%\' ORDER BY s."publishedAt" NULLS LAST, s."createdAt" LIMIT 1',
  );
  if (!rows[0]) throw new Error('No published seed set found');
  return rows[0];
}

async function reviewEventCount(db: Client, userId: string, eventId: string) {
  const { rows } = await db.query<{ count: string }>('SELECT count(*)::text FROM app."ReviewEvent" WHERE "userId"=$1 AND "eventId"=$2::uuid', [userId, eventId]);
  return Number(rows[0]?.count ?? 0);
}

function pushSettings() {
  return {
    enabled: false,
    configured: true,
    publicKey: vapidPublicKey,
    quietStart: '22:00',
    quietEnd: '08:00',
    subscriptions: [],
  };
}
