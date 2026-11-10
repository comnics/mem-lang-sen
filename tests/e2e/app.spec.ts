import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3100';
const localPassword = 'LocalStudy!2026';
const testTags: string[] = [];
const signupEmails: string[] = [];
const extraAudioIds: string[] = [];
if (new URL(origin).hostname !== '127.0.0.1' || !process.env.DIRECT_URL || !['127.0.0.1', 'localhost'].includes(new URL(process.env.DIRECT_URL).hostname)) throw new Error('E2E requires isolated local Supabase.');

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(localPassword);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/(admin|today|onboarding)$/);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
}

test('public mobile pages and three-sentence demo render without horizontal overflow', async ({ page }) => {
  for (const path of ['/', '/demo', '/login', '/signup', '/forgot-password']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await noOverflow(page);
  }
  await page.goto('/');
  await page.screenshot({ path: 'test-results/mobile-home.png', fullPage: true });
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
});

test('admin publishes audio sentence; learner enrolls, recalls, reveals and records spoken self-check', async ({ page, browser }) => {
  const tag = randomUUID().slice(0, 8);
  testTags.push(tag);
  const prompt = `다시 말씀해 주시겠어요? ${tag}`;
  const title = `반복 요청 연습 ${tag}`;
  const target = 'Could you say that again?';
  await login(page, 'admin@example.test');
  await page.goto('/admin/sentences');
  await page.getByRole('button', { name: '새 문장', exact: true }).click();
  await page.getByLabel('회상 질문 · 한국어 상황', { exact: true }).fill(prompt);
  await page.getByLabel('보조 뜻 · 상황 설명', { exact: true }).fill('상대에게 반복을 요청하세요.');
  await page.getByLabel('정답 문장', { exact: true }).fill(target);
  await page.getByLabel('허용 답안', { exact: true }).fill(target);
  await page.getByLabel('힌트', { exact: true }).fill('Could you로 정중하게 시작하세요.');
  await page.getByLabel('해설', { exact: true }).fill('상대의 말을 다시 듣고 싶을 때 쓰는 표현입니다.');
  await page.getByLabel('오디오', { exact: true }).setInputFiles('fixtures/audio/seed-1.wav');
  await expect(page.getByText('오디오 업로드를 완료했습니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '문장 저장', exact: true }).click();
  await expect(page.getByText('문장을 만들었습니다.', { exact: true })).toBeVisible();
  await page.goto('/admin/sets');
  await page.getByRole('button', { name: '새 초안', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page.getByLabel('설명', { exact: true }).fill('한 문장으로 검증하는 관리자 발행과 학습 흐름');
  await page.getByRole('checkbox', { name: new RegExp(tag) }).check();
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await expect(page.getByText('새 세트 초안을 만들었습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '검토 요청', exact: true }).click();
  await expect(page.getByText('검토 상태로 보냈습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '발행', exact: true }).click();
  await expect(page.getByText('세트를 발행했습니다.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: new RegExp(tag) })).toBeChecked();
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/mobile-admin.png', fullPage: true });

  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const learner = await context.newPage();
  await login(learner, 'learner@example.test');
  if (learner.url().endsWith('/onboarding')) {
    await learner.getByLabel('표시 이름').fill('기억하는 학습자');
    await learner.getByRole('button', { name: '오늘 학습으로 이동' }).click();
    await expect(learner).toHaveURL(/\/today$/);
  }
  await learner.goto('/sets');
  await learner.getByRole('link').filter({ hasText: title }).click();
  await expect(learner).toHaveURL(/\/sets\/[^/]+$/);
  const setPath = new URL(learner.url()).pathname;
  await learner.getByRole('button', { name: '내 세트로 등록', exact: true }).click();
  await learner.getByRole('button', { name: '입력 회상', exact: true }).click();
  await expect(learner).toHaveURL(/\/study\//);
  const sessionId = learner.url().split('/').at(-1)!;
  const issued = await learner.request.get(`/api/v1/study-sessions/${sessionId}`);
  expect(issued.ok()).toBeTruthy();
  const issuedJson = await issued.json();
  expect(JSON.stringify(issuedJson)).not.toContain(target);
  expect(await learner.content()).not.toContain(target);
  await noOverflow(learner);
  await learner.screenshot({ path: 'test-results/mobile-study.png', fullPage: true });
  await learner.getByLabel('내가 떠올린 영어 문장').fill(target);
  // Break only this test's asset path so real Storage signing fails, without mocking the answer route.
  const outageDb = new Client({ connectionString: process.env.DIRECT_URL });
  await outageDb.connect();
  const { rows: [asset] } = await outageDb.query<{ id: string; path: string }>(
    'SELECT a.id, a.path FROM app."AudioAsset" a JOIN app."SentenceVersion" sv ON sv."audioAssetId"=a.id WHERE sv.prompt=$1', [prompt],
  );
  let submitted: { itemId: string; eventId: string; answer: string };
  try {
    await outageDb.query('UPDATE app."AudioAsset" SET path=$1 WHERE id=$2', [`missing/${randomUUID()}.wav`, asset.id]);
    const responsePromise = learner.waitForResponse((response) => response.url().endsWith(`/study-sessions/${sessionId}/answers`) && response.request().method() === 'POST');
    await learner.getByRole('button', { name: '제출', exact: true }).click();
    const response = await responsePromise;
    submitted = response.request().postDataJSON();
    expect(response.status()).toBe(200);
    const first = await response.json();
    expect(first).toMatchObject({ result: 'CORRECT', correct: true, completed: true });
    expect(first).not.toHaveProperty('audioUrl');
    expect(first).not.toHaveProperty('audioPath');
    await expect(learner.getByText('정답으로 기록했어요', { exact: true })).toBeVisible();
    await expect.poll(() => learner.evaluate(() => Object.keys(sessionStorage)
      .filter((key) => key.startsWith('mem-lang-sen:outbox:v1:'))
      .flatMap((key) => JSON.parse(sessionStorage.getItem(key) ?? '[]')))).toEqual([]);
    const replay = await learner.request.post(`/api/v1/study-sessions/${sessionId}/answers`, { headers: { Origin: origin }, data: submitted });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(first);
    const changed = await learner.request.post(`/api/v1/study-sessions/${sessionId}/answers`, { headers: { Origin: origin }, data: { ...submitted, answer: 'Changed' } });
    expect(changed.status()).toBe(409);
  } finally {
    await outageDb.query('UPDATE app."AudioAsset" SET path=$1 WHERE id=$2', [asset.path, asset.id]);
    await outageDb.end();
  }
  const recovered = await learner.request.post(`/api/v1/study-sessions/${sessionId}/answers`, { headers: { Origin: origin }, data: submitted! });
  expect(recovered.status()).toBe(200);
  const audioSrc = (await recovered.json()).audioUrl;
  expect(audioSrc).toContain('/storage/v1/object/sign/');
  expect((await learner.request.get(audioSrc)).ok()).toBeTruthy();
  const countDb = new Client({ connectionString: process.env.DIRECT_URL });
  await countDb.connect();
  try {
    const { rows: [row] } = await countDb.query('SELECT count(*)::int AS count FROM app."ReviewEvent" WHERE "sessionItemId"=$1', [submitted!.itemId]);
    expect(row.count).toBe(1);
  } finally { await countDb.end(); }
  await learner.reload();
  await expect(learner.getByRole('button', { name: '제출', exact: true })).toBeDisabled();
  await learner.goto('/history');
  await expect(learner.getByRole('heading', { name: title, exact: true })).toBeVisible();

  await learner.goto(setPath);
  await learner.getByRole('button', { name: '입력 회상', exact: true }).click();
  await expect(learner).toHaveURL(/\/study\//);
  await learner.getByRole('button', { name: '힌트', exact: true }).click();
  await expect(learner.getByText('Could you로 정중하게 시작하세요.', { exact: true })).toBeVisible();
  await learner.getByLabel('내가 떠올린 영어 문장').fill(target);
  await learner.getByRole('button', { name: '제출', exact: true }).click();
  await expect(learner.getByText('도움 후 답으로 기록했어요', { exact: true })).toBeVisible();
  await learner.goto(setPath);
  await learner.getByRole('button', { name: '말하기 자기확인', exact: true }).click();
  await expect(learner).toHaveURL(/\/study\//);
  await learner.getByRole('button', { name: '답 열기', exact: true }).click();
  await learner.getByRole('button', { name: '괜찮았어요', exact: true }).click();
  await expect(learner.getByText('말하기 자기확인을 기록했어요', { exact: true })).toBeVisible();
  const history = await (await learner.request.get('/api/v1/history')).json();
  const written = history.filter((row: { setTitle: string; mode: string }) => row.setTitle === title && row.mode === 'WRITTEN');
  expect(written.map((row: { correctCount: number }) => row.correctCount).sort()).toEqual([0, 1]);
  expect(history.find((row: { setTitle: string; mode: string }) => row.setTitle === title && row.mode === 'SPOKEN').correctCount).toBe(0);

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await login(other, 'other@example.test');
  expect((await other.request.get(`/api/v1/study-sessions/${sessionId}`)).status()).toBe(404);
  expect((await other.request.get('/api/v1/admin/sets')).status()).toBe(403);
  await other.goto('/admin');
  await expect(other).toHaveURL(/\/today$/);
  await otherContext.close();
  await context.close();
});

test('current administrator role is rechecked and mutation inputs are validated', async ({ page }) => {
  await login(page, 'admin@example.test');
  expect((await page.request.post('/api/v1/enrollments', { headers: { Origin: 'https://untrusted.invalid' }, data: { setId: 'invalid' } })).status()).toBe(400);
  const db = new Client({ connectionString: process.env.DIRECT_URL });
  await db.connect();
  try {
    await db.query('UPDATE app."AppUser" SET role=\'USER\' WHERE email=$1', ['admin@example.test']);
    expect((await page.request.get('/api/v1/admin/sets')).status()).toBe(403);
    await db.query('UPDATE app."AppUser" SET role=\'ADMIN\', status=\'SUSPENDED\' WHERE email=$1', ['admin@example.test']);
    expect((await page.request.get('/api/v1/admin/sets')).status()).toBe(403);
  } finally {
    await db.query('UPDATE app."AppUser" SET role=\'ADMIN\',status=\'ACTIVE\' WHERE email=$1', ['admin@example.test']);
    await db.end();
  }
  expect((await page.request.get('/api/v1/admin/sets')).ok()).toBeTruthy();
  await page.request.post('/api/auth/signout', { headers: { Origin: origin } });
  expect((await page.request.get('/api/v1/admin/sets')).status()).toBe(401);
});

async function latestMailLink(page: Page, email: string, type: 'signup' | 'recovery') {
  let id: string | undefined;
  await expect.poll(async () => {
    const inbox = await (await page.request.get('http://127.0.0.1:54324/api/v1/messages')).json();
    const messages = inbox.messages as { ID: string; To: { Address: string }[]; Subject: string }[];
    id = messages.find((message) => message.To.some((to) => to.Address === email) && message.Subject.includes(type === 'signup' ? '이메일 확인' : '비밀번호 재설정'))?.ID;
    return Boolean(id);
  }).toBeTruthy();
  const message = await (await page.request.get(`http://127.0.0.1:54324/api/v1/message/${id}`)).json();
  const html = String(message.HTML ?? message.Text);
  const link = html.match(/https?:\/\/[^"\s<>]+\/auth\/confirm\?[^"\s<>]+/)?.[0]?.replaceAll('&amp;', '&');
  expect(link).toContain(`type=${type}`);
  expect(new URL(link!).origin).toBe(origin);
  return link!;
}

test('email confirmation and password recovery use real local Auth and mail delivery', async ({ page }) => {
  const email = `signup-${randomUUID()}@example.test`;
  signupEmails.push(email);
  await page.goto('/signup');
  await page.getByLabel('이름', { exact: true }).fill('메일 확인 학습자');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(localPassword);
  await page.getByRole('button', { name: '가입 메일 받기' }).click();
  await expect(page.getByRole('status')).toContainText('가입 확인 메일');
  const confirmation = await latestMailLink(page, email, 'signup');
  await page.goto(confirmation);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByLabel('표시 이름')).toBeVisible();
  await page.request.post('/api/auth/signout', { headers: { Origin: origin } });
  await page.goto('/forgot-password');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByRole('button', { name: '재설정 메일 받기' }).click();
  await expect(page.getByRole('status')).toContainText('재설정 링크');
  const recovery = await latestMailLink(page, email, 'recovery');
  await page.goto(recovery);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel('비밀번호', { exact: true }).fill('RecoveredStudy!2026');
  await page.getByRole('button', { name: '새 비밀번호 저장' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.request.post('/api/auth/signout', { headers: { Origin: origin } });
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill('RecoveredStudy!2026');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByLabel('표시 이름')).toBeVisible();
});

test('private schema, malformed audio and invalid CSV cannot bypass server validation', async ({ page }) => {
  const hiddenSchema = await page.request.get(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/AppUser`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, 'Accept-Profile': 'app' } });
  expect(hiddenSchema.ok()).toBeFalsy();
  await login(page, 'admin@example.test');
  const before = await (await page.request.get('/api/v1/admin/sentences')).json();
  const imported = await page.request.post('/api/v1/admin/imports', { headers: { Origin: origin }, data: { commit: true, csv: 'prompt,meaning,target,acceptedAnswers,hint,explanation,level\n정상 행,상황,Hello,Hello,Hi,설명,A1\n오류 행,상황,Hi,Hi,Hi,설명,C2' } });
  expect((await imported.json()).imported).toBe(0);
  const after = await (await page.request.get('/api/v1/admin/sentences')).json();
  expect(after.length).toBe(before.length);
  const signed = await page.request.post('/api/v1/admin/audio', { headers: { Origin: origin }, data: { action: 'sign', fileName: 'invalid.wav', size: 4, contentType: 'audio/wav' } });
  expect(signed.ok()).toBeTruthy();
  const audio = await signed.json();
  extraAudioIds.push(audio.id);
  const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } }).storage;
  const upload = await storage.from('sentence-audio').uploadToSignedUrl(audio.path, audio.token, new Uint8Array([1, 2, 3, 4]), { contentType: 'audio/wav' });
  expect(upload.error).toBeNull();
  const complete = await page.request.post('/api/v1/admin/audio', { headers: { Origin: origin }, data: { action: 'complete', id: audio.id } });
  expect(complete.status()).toBe(400);
});

test.afterAll(async () => {
  const db = new Client({ connectionString: process.env.DIRECT_URL });
  await db.connect();
  const platform = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  try {
    for (const tag of testTags) {
      const { rows: sets } = await db.query('SELECT id FROM app."StudySet" WHERE title=$1', [`반복 요청 연습 ${tag}`]);
      for (const set of sets) {
        await db.query('DELETE FROM app."StudySession" WHERE "setId"=$1', [set.id]);
        await db.query('DELETE FROM app."StudySet" WHERE id=$1', [set.id]);
      }
      const { rows: versions } = await db.query('SELECT "sentenceId","audioAssetId" FROM app."SentenceVersion" WHERE prompt=$1', [`다시 말씀해 주시겠어요? ${tag}`]);
      for (const version of versions) {
        await db.query('DELETE FROM app."UserSentenceState" WHERE "sentenceId"=$1', [version.sentenceId]);
        await db.query('DELETE FROM app."UserSentencePreference" WHERE "sentenceId"=$1', [version.sentenceId]);
        await db.query('DELETE FROM app."SentenceVersion" WHERE "sentenceId"=$1', [version.sentenceId]);
        await db.query('DELETE FROM app."Sentence" WHERE id=$1', [version.sentenceId]);
        if (version.audioAssetId) extraAudioIds.push(version.audioAssetId);
      }
    }
    for (const id of extraAudioIds) {
      const { rows } = await db.query('DELETE FROM app."AudioAsset" WHERE id=$1 RETURNING path', [id]);
      if (rows.length) await platform.storage.from('sentence-audio').remove(rows.map((row) => row.path));
    }
    const { data } = await platform.auth.admin.listUsers({ perPage: 1000 });
    for (const user of data.users.filter((user) => signupEmails.includes(user.email ?? ''))) {
      await db.query('DELETE FROM app."AppUser" WHERE id=$1', [user.id]);
      await platform.auth.admin.deleteUser(user.id);
    }
  } finally { await db.end(); }
});
