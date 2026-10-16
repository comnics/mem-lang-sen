import { test, expect, type Page, type Route } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
// Reuse the bundler already installed by tsx, without adding an app dependency.
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild') as {
  buildSync(options: object): { outputFiles: { text: string }[] };
};
const bundle = buildSync({
  entryPoints: [resolve('tests/components/harness.tsx')], bundle: true, write: false,
  format: 'iife', platform: 'browser', jsx: 'automatic',
  alias: { 'next/link': resolve('tests/components/link.tsx'), 'next/navigation': resolve('tests/components/navigation.ts') },
  define: { 'process.env.NODE_ENV': '"development"' },
}).outputFiles[0].text;
const css = readFileSync('src/app/globals.css', 'utf8').replace(/@import[^;]+;/g, '');

async function mount(page: Page, component: string) {
  page.on('pageerror', error => { throw error; });
  await page.route('http://localhost:59999/**', route => {
    if (route.request().resourceType() === 'document') return route.fulfill({
      contentType: 'text/html', body: '<html><head></head><body><div id="root"></div></body></html>',
    });
    return route.abort();
  });
  await page.goto('http://localhost:59999/?component=' + component);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
for (const outcome of ['success', 'http-error', 'network-error']) {
  test('records save/report pending and ' + outcome, async ({ page }) => {
    await mount(page, 'records');
    await page.getByLabel('개인 메모').fill('보존할 메모');
    await page.getByLabel('문장 신고').fill('음원 문제');
    for (const action of ['save', 'report']) {
      const path = action === 'save' ? 'sentence-preferences' : 'reports';
      // Register without awaiting the response promise until after clicking.
      let captured!: Route;
      let requests = 0;
      await page.route('**/api/v1/' + path, route => { requests++; captured = route; });
      await page.getByRole('button', { name: action === 'save' ? '저장' : '신고', exact: true }).click();
      await expect.poll(() => Boolean(captured)).toBe(true);
      await expect(page.getByRole('button', { name: /저장/ })).toBeDisabled();
      await expect(page.getByRole('button', { name: /신고/ })).toBeDisabled();
      await page.getByRole('button', { name: /저장/ }).evaluate(button => (button as HTMLButtonElement).click());
      await page.getByRole('button', { name: /신고/ }).evaluate(button => (button as HTMLButtonElement).click());
      expect(requests).toBe(1);
      expect(captured.request().method()).toBe(action === 'save' ? 'PATCH' : 'POST');
      expect(captured.request().postDataJSON()).toMatchObject(action === 'save'
        ? { note: '보존할 메모', sentenceId: 's1' } : { detail: '음원 문제', sentenceVersionId: 'v1' });
      if (outcome === 'network-error') await captured.abort();
      else await captured.fulfill({ status: outcome === 'success' ? 200 : 500,
        json: outcome === 'success' ? {} : { error: '테스트 오류' } });
      await expect(page.getByRole(outcome === 'success' ? 'status' : 'alert')).toBeVisible();
      await expect(page.getByLabel('개인 메모')).toHaveValue('보존할 메모');
      await expect(page.getByLabel('문장 신고')).toHaveValue(
        action === 'report' && outcome === 'success' ? '' : '음원 문제');
      await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
    }
  });
}

test('today failure retains queue and keyboard can retry successfully', async ({ page }) => {
  await mount(page, 'today');
  let captured!: Route;
  let requests = 0;
  await page.route('**/api/v1/today?*', route => { requests++; captured = route; });
  const written = page.getByRole('radio', { name: '입력' });
  const spoken = page.getByRole('radio', { name: '말하기' });
  await written.focus();
  await page.keyboard.press('ArrowRight');
  await expect(spoken).toBeDisabled();
  await page.keyboard.press('Space');
  expect(requests).toBe(1);
  await expect(page.getByText('기존 입력 큐', { exact: true })).toBeVisible();
  await captured.fulfill({ status: 500, json: { error: '조회 실패' } });
  await expect(page.getByRole('alert')).toHaveText('조회 실패');
  await expect(written).toBeChecked();
  await expect(page.getByText('기존 입력 큐', { exact: true })).toBeVisible();
  // Disabled focused controls may lose focus: require focus recovery after response.
  await expect(spoken).toBeFocused();
  await page.keyboard.press('Space');
  await expect(spoken).toBeDisabled();
  await captured.fulfill({ json: {
    mode: 'SPOKEN', localDate: '2026-10-16', timezone: 'Asia/Seoul', paused: false,
    isStudyDay: true, items: [], calendar: [], completedToday: 0,
    dueCount: 0, overdueCount: 0, newCount: 0, deferredCount: 0,
  } });
  await expect(spoken).toBeChecked();
  await expect(page.getByText('기존 입력 큐', { exact: true })).toHaveCount(0);
  await expect(spoken).toBeFocused();
});

test('study result and next prompt receive focus after offline retry', async ({ page }) => {
  await mount(page, 'study');
  await page.route('**/reveals', route => route.fulfill({ json: { text: '힌트 내용' } }));
  await page.getByRole('button', { name: '힌트', exact: true }).click();
  await expect(page.getByText('힌트 내용')).toBeVisible();
  const input = page.getByLabel('내가 떠올린 영어 문장');
  await input.fill('My answer');
  const submissions: unknown[] = [];
  await page.route('**/answers', route => {
    submissions.push(route.request().postDataJSON());
    return submissions.length === 1 ? route.abort() : route.fulfill({ json: {
      correct: true, result: 'ASSISTED', target: 'My answer', acceptedAnswers: [],
      explanation: '설명', completed: false, nextDueAt: null, reviewStep: 0,
      qualified: false, reviewReason: null,
    } });
  });
  await page.getByRole('button', { name: '제출', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(input).toBeDisabled();
  await page.getByRole('button', { name: '같은 답안 다시 전송', exact: true }).click();
  await expect(page.getByRole('heading', { name: '도움 후 답으로 기록했어요' })).toBeFocused();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(await page.evaluate(() => Object.values(sessionStorage).flatMap(value => JSON.parse(value)))).toEqual([]);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByText('다음 문제', { exact: true })).toBeFocused();
  await expect(input).toHaveValue('');
});
