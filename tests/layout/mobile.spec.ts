import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const css = readFileSync(process.env.LAYOUT_CSS ?? 'src/app/globals.css', 'utf8').replace(/@import[^;]+;/g, '');
const fixture = `<div class="app-shell">
<header class="topbar"><span class="brand-mark"><span class="brand-symbol">✿</span>문장정원</span><a class="button-ghost" href="#settings" aria-label="설정"><span>${'이름'.repeat(40)}</span></a></header>
<main class="app-main"><form class="card stack">
<h1>${'긴한국어문장'.repeat(24)}</h1><p>${'LongEnglishToken'.repeat(8)}</p>
<label class="field">답안<textarea class="textarea">${'메모'.repeat(500)}</textarea></label>
<fieldset class="field"><legend>규칙</legend><div class="segmented-control"><label><input type="radio" name="mode" checked><span>입력</span></label><label><input type="radio" name="mode"><span>말하기</span></label></div></fieldset>
<fieldset class="field"><legend>요일</legend><div class="weekday-grid">${['월','화','수','목','금','토','일'].map(day => `<label class="check-pill"><input type="checkbox"><span>${day}</span></label>`).join('')}</div></fieldset>
<div class="stats-grid">${Array.from({length:3}, () => '<div class="stat"><strong>9999</strong><span>복습</span></div>').join('')}</div>
<div class="calendar-strip"><div class="calendar-day">완료 9999 · 예정 9999</div><div class="calendar-day">평가 9999 · 검증 9999</div></div>
<div class="assessment-grid">${'<div class="metric-card">미응시</div>'.repeat(4)}</div>
<audio controls></audio><button class="button" type="button">같은 답안 다시 전송</button>
</form></main><nav class="bottom-nav">${['오늘','세트','내 문장','달력','기록'].map(t => `<a class="nav-item" href="#${t}">${t}</a>`).join('')}</nav></div>`;

test.beforeEach(async ({ page }) => {
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1">' + fixture);
  await page.addStyleTag({ content: css });
});

for (const width of [320, 375, 390, 768, 1024, 1440]) {
  test(`long content, targets and centered navigation at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: info.outputPath(`layout-${width}.png`), fullPage: true });
    const measurements = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav')!.getBoundingClientRect();
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        navCenterError: nav.x + nav.width / 2 - innerWidth / 2,
        inputFontSize: getComputedStyle(document.querySelector('textarea')!).fontSize };
    });
    writeFileSync(info.outputPath('measurements.json'), JSON.stringify(measurements, null, 2));
    await info.attach('measurements', { body: JSON.stringify(measurements), contentType: 'application/json' });
    expect(measurements.scrollWidth).toBeLessThanOrEqual(width + 1);
    const nav = await page.locator('.bottom-nav').boundingBox();
    expect(Math.abs(nav!.x + nav!.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    for (const target of await page.locator('.nav-item, .check-pill').all()) {
      const box = await target.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator('textarea').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    const days = await page.locator('.check-pill').evaluateAll(els => els.map(el => el.getBoundingClientRect().y));
    expect(new Set(days).size).toBe(width < 720 ? 2 : 1);
    const columns = (selector: string) => page.locator(selector).evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(await columns('.calendar-strip')).toBe(width < 360 ? 1 : 2);
    expect(await columns('.assessment-grid')).toBe(width < 720 ? 1 : 2);
  });
}

test('visible keyboard focus follows native checkbox and radio selection', async ({ page }) => {
  const weekday = page.locator('.check-pill input').first();
  await weekday.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(weekday).toBeFocused();
  await expect(page.locator('.check-pill').first()).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Space');
  await expect(weekday).toBeChecked();
  const radio = page.locator('input[type=radio]');
  await radio.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(radio.last()).toBeChecked();
  await expect(radio.last()).toBeFocused();
  await expect(page.locator('.segmented-control span').last()).toHaveCSS('outline-style', 'solid');
});

test('text editing releases overlays and preserves entered text on blur', async ({ page }) => {
  await page.locator('textarea').fill('키보드 편집 테스트');
  await expect(page.locator('.topbar')).toHaveCSS('position', 'static');
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await page.locator('textarea').blur();
  await expect(page.locator('.bottom-nav')).toHaveCSS('position', 'fixed');
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.locator('textarea')).toHaveValue('키보드 편집 테스트');
});

test('200% text enlargement keeps long content within the viewport', async ({ page }) => {
  await page.addStyleTag({ content: '.app-shell :is(p,h1,strong,span,a,button) { font-size: 200%; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
});

test('first submit click survives leaving the answer field at the bottom of a short page', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent(`<div class="app-shell"><header class="topbar">문장정원</header>
    <main class="app-main"><section class="card stack-lg"><h1>입력 회상</h1>
    <p style="height:300px">회상 질문</p><label class="field">답안<textarea class="textarea"></textarea></label>
    <button class="button" type="button">제출</button></section></main>
    <nav class="bottom-nav">${'<a class="nav-item" href="#">메뉴</a>'.repeat(5)}</nav></div>`);
  await page.addStyleTag({ content: css });
  await page.getByRole('button', { name: '제출' }).evaluate(button => {
    button.addEventListener('click', () => { button.textContent = '제출 완료'; });
  });
  await page.getByRole('textbox').fill('My answer');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('button', { name: '제출', exact: true }).click();
  await expect(page.getByRole('button', { name: '제출 완료' })).toBeVisible();
});
