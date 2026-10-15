import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const password = 'LocalStudy!2026';
const email = `m4-${randomUUID()}@example.test`;
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3100';
let userId: string | undefined;
let client: Client;
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

test.beforeAll(async () => {
  if (new URL(process.env.DIRECT_URL!).hostname !== '127.0.0.1' || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname !== '127.0.0.1') throw new Error('Local Supabase only');
  client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('Test signup failed');
  userId = data.user.id;
});
test.afterAll(async () => {
  if (userId) {
    await client.query('DELETE FROM app."AppUser" WHERE id=$1', [userId]);
    await supabase.auth.admin.deleteUser(userId);
  }
  await client?.end();
});

test('schedule settings, date exceptions, daily study and pause are usable on mobile', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('표시 이름', { exact: true }).fill('복습 학습자');
  await page.getByLabel('시간대', { exact: true }).fill('UTC');
  await page.getByLabel('시작일', { exact: true }).fill(today);
  await page.getByLabel('학습 시간', { exact: true }).fill('00:00');
  await page.getByRole('radio', { name: '주기별', exact: true }).check();
  await page.getByLabel('반복 간격', { exact: true }).fill('2');
  await page.getByLabel('기준일', { exact: true }).fill(today);
  await page.getByRole('button', { name: '오늘 학습으로 이동', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  const plan = await (await page.request.get('/api/v1/study-plan')).json();
  expect(plan).toMatchObject({ ruleType: 'INTERVAL', intervalDays: 2, anchorDate: today, timezone: 'UTC', localTime: '00:00' });

  const { rows } = await client.query('SELECT id FROM app."StudySet" WHERE status=\'PUBLISHED\' AND id LIKE \'cmemseedset%\' ORDER BY id LIMIT 1');
  const setId = rows[0].id;
  await page.goto(`/sets/${setId}`);
  await page.getByRole('button', { name: '내 세트로 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '등록 해제', exact: true })).toBeVisible();
  await page.goto('/today');
  await expect(page.getByRole('button', { name: '오늘 학습 시작', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: 'test-results/m4-today.png', fullPage: true });

  // Date exception overrides the anchored N-day rule.
  await page.goto('/onboarding');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByLabel('예외 날짜').fill(today);
  await page.getByLabel('예외 종류').selectOption('SKIP');
  await page.getByRole('button', { name: '오늘 학습으로 이동', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText('오늘은 계획된 학습일이 아닙니다.', { exact: true })).toBeVisible();
  expect((await page.request.post('/api/v1/today', { headers: { origin }, data: { mode: 'WRITTEN' } })).status()).toBe(409);
  await page.goto('/onboarding');
  await page.getByLabel('예외 종류').selectOption('ADD');
  await page.screenshot({ path: 'test-results/m4-schedule.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.getByRole('button', { name: '오늘 학습으로 이동', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.getByRole('button', { name: '오늘 학습 시작', exact: true }).click();
  await expect(page).toHaveURL(/\/study\//);
  const sessionId = page.url().split('/').at(-1)!;
  const session = await (await page.request.get(`/api/v1/study-sessions/${sessionId}`)).json();
  const targets = await client.query('SELECT i.id,v.target FROM app."SessionItem" i JOIN app."SentenceVersion" v ON v.id=i."sentenceVersionId" WHERE i."sessionId"=$1 ORDER BY i.position', [sessionId]);
  expect(session.setTitle).toBe('오늘 복습');
  expect(session.items).toHaveLength(3);
  for (const row of targets.rows) expect(JSON.stringify(session)).not.toContain(row.target);
  await page.getByLabel('내가 떠올린 영어 문장').fill(targets.rows[0].target);
  await page.getByLabel('정답이어도 어려웠어요').check();
  await page.getByRole('button', { name: '제출', exact: true }).click();
  await expect(page.getByText('정답으로 기록했어요', { exact: true })).toBeVisible();
  await expect(page.getByText('복습 단계 0 · 지연 회상 미인정 · 첫 정답을 기록했어요. 하루 뒤 다시 떠올려 봐요', { exact: true })).toBeVisible();
  const event = (await client.query('SELECT hard,qualified,"nextDueAt","studyDate",timezone FROM app."ReviewEvent" WHERE "sessionItemId"=$1', [targets.rows[0].id])).rows[0];
  expect(event).toMatchObject({ hard: true, qualified: false, studyDate: today, timezone: 'UTC' });
  expect(event.nextDueAt).toBeTruthy();
  await page.goto('/today');
  await expect(page.getByRole('link', { name: /진행 중인 오늘 학습 이어가기/ })).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('checkbox', { name: '전체 오늘 학습을 잠시 멈추기' }).check();
  await page.getByRole('button', { name: '오늘 학습으로 이동', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText('오늘 학습을 멈춰 두었습니다.', { exact: true })).toBeVisible();
  await page.goto(`/study/${sessionId}`);
  await expect(page.getByRole('button', { name: '제출', exact: true })).toHaveCount(0);
  expect((await client.query('SELECT count(*)::int AS n FROM app."ReviewEvent" WHERE "userId"=$1', [userId])).rows[0].n).toBe(1);
});
