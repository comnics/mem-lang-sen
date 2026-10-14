import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const password = 'LocalStudy!2026';
const email = `m5-${randomUUID()}@example.test`;
const origin = process.env.APP_ORIGIN!;
let userId: string | undefined;
let db: Client;
const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
test.beforeAll(async () => {
  if (new URL(process.env.DIRECT_URL!).hostname !== '127.0.0.1' || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname !== '127.0.0.1') throw Error('Local tests only');
  db = new Client({ connectionString: process.env.DIRECT_URL });
  await db.connect();
  const result = await auth.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw result.error ?? Error('Auth fixture failed');
  userId = result.data.user.id;
});
test.afterAll(async () => {
  if (userId) { await db.query('DELETE FROM app."AppUser" WHERE id=$1', [userId]); await auth.auth.admin.deleteUser(userId); }
  await db?.end();
});

test('weekly recall/application, private records, calendar and administrator quality work on mobile', async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/onboarding/);
  const today = new Date().toISOString().slice(0, 10);
  const plan = await page.request.put('/api/v1/study-plan', { headers: { origin }, data: { displayName: '평가 학습자', dailyMinutes: 20, timezone: 'UTC', weekdays: [0,1,2,3,4,5,6], startDate: today, anchorDate: today, localTime: '00:00' } });
  expect(plan.ok()).toBeTruthy();
  const sets = await db.query('SELECT id FROM app."StudySet" WHERE id LIKE \'cmemseedset%\' AND status=\'PUBLISHED\' ORDER BY id');
  for (const set of sets.rows) {
    expect((await page.request.post('/api/v1/enrollments', { headers: { origin }, data: { setId: set.id } })).ok()).toBeTruthy();
    const started = await page.request.post('/api/v1/study-sessions', { headers: { origin }, data: { setId: set.id, mode: 'WRITTEN' } });
    const session = await started.json();
    const items = await db.query('SELECT i.id,v.target FROM app."SessionItem" i JOIN app."SentenceVersion" v ON v.id=i."sentenceVersionId" WHERE i."sessionId"=$1', [session.id]);
    for (const item of items.rows) expect((await page.request.post(`/api/v1/study-sessions/${session.id}/answers`, { headers: { origin }, data: { itemId: item.id, eventId: randomUUID(), answer: item.target } })).ok()).toBeTruthy();
  }
  await page.goto('/assessments');
  await expect(page.getByRole('heading', { name: '정말 외웠는지 확인' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: 'test-results/m5-assessments.png', fullPage: true });
  await page.getByRole('button', { name: '주간 누적/응용 평가 시작' }).click();
  await expect(page).toHaveURL(/study\//);
  const sessionId = page.url().split('/').at(-1)!;
  const items = await db.query('SELECT i.id,i.form,COALESCE(q.target,v.target) AS target FROM app."SessionItem" i JOIN app."SentenceVersion" v ON v.id=i."sentenceVersionId" LEFT JOIN app."ApplicationQuestion" q ON q.id=i."applicationQuestionId" WHERE i."sessionId"=$1 ORDER BY i.position', [sessionId]);
  expect(items.rows.some((item) => item.form === 'APPLICATION')).toBeTruthy();
  for (let index=0; index<items.rows.length; index++) {
    await expect(page.getByRole('button', { name: '힌트', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '답 보기', exact: true })).toBeDisabled();
    await page.getByLabel('내가 떠올린 영어 문장').fill(items.rows[index].target);
    await page.getByRole('button', { name: '제출', exact: true }).click();
    await expect(page.getByText('정답으로 기록했어요', { exact: true })).toBeVisible();
    if (index < items.rows.length-1) await page.getByRole('button', { name: '다음', exact: true }).click();
  }
  const counts = await db.query('SELECT count(*)::int AS n FROM app."ReviewEvent" e JOIN app."SessionItem" i ON i.id=e."sessionItemId" WHERE i."sessionId"=$1', [sessionId]);
  expect(counts.rows[0].n).toBe(items.rows.length);
  await page.goto('/sentences');
  await page.getByLabel('개인 메모').first().fill('모바일 평가 테스트 메모');
  await page.getByLabel('내가 외웠다고 표시').first().check();
  await page.getByRole('button', { name: '저장', exact: true }).first().click();
  await expect(page.getByText('저장했습니다.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('개인 메모').first()).toHaveValue('모바일 평가 테스트 메모');
  await expect(page.getByLabel('내가 외웠다고 표시').first()).toBeChecked();
  await page.getByLabel('문장 신고').first().fill('M5 모바일 검증 신고');
  await page.getByRole('button', { name: '신고', exact: true }).first().click();
  await expect(page.getByText('신고를 보냈습니다.', { exact: true })).toBeVisible();
  await page.goto('/calendar');
  expect(await page.locator('.calendar-day').count()).toBe(new Date(new Date().getUTCFullYear(), new Date().getUTCMonth()+1,0).getDate());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBeTruthy();
  await page.screenshot({ path: 'test-results/m5-calendar.png', fullPage: true });
  const adminContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  try {
    const admin = await adminContext.newPage();
    await admin.goto(`${origin}/login`);
    await admin.getByLabel('이메일', { exact: true }).fill('admin@example.test');
    await admin.getByLabel('비밀번호', { exact: true }).fill(password);
    await admin.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(admin).toHaveURL(/admin/);
    for (const path of ['application-questions', 'reports', 'quality']) {
      await admin.goto(`${origin}/admin/${path}`);
      expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBeTruthy();
      await admin.screenshot({ path: `test-results/m5-admin-${path}.png`, fullPage: true });
      await expect(admin.getByText('모바일 평가 테스트 메모')).toHaveCount(0);
    }
  } finally { await adminContext.close(); }
});
