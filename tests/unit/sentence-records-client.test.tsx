// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentenceRecordsClient } from '@/features/learner/SentenceRecordsClient';

const reasons = [
  ['TYPO', '오탈자'], ['ANSWER', '정답'], ['AUDIO', '음원'], ['MEANING', '뜻'], ['OTHER', '기타'],
] as const;
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(sentenceVersionId: string | null = 'v1') {
  await act(async () => root.render(<SentenceRecordsClient sentence={{ sentenceId: 's1', sentenceVersionId, note: '개인 기록', hidden: true, selfReportedMemorized: true }} />));
}
function control<T extends HTMLElement>(selector: string) {
  const element = container.querySelector<T>(selector);
  expect(element, selector).not.toBeNull();
  return element!;
}
function button(name: string) {
  const element = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  expect(element, name).toBeDefined();
  return element!;
}
async function detail(value: string) {
  const input = control<HTMLInputElement>('input:not([type="checkbox"])');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function select(value: string) {
  await act(async () => {
    const input = control<HTMLSelectElement>('select');
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(name: string) { await act(async () => button(name).click()); }
function body(index = 0) { return JSON.parse(String(fetchMock.mock.calls[index][1]!.body)); }

describe('sentence report reason selection', () => {
  it('labels a native select with all five Korean options and defaults to OTHER', async () => {
    await render();
    const input = control<HTMLSelectElement>('select');
    expect(input.labels?.[0]?.textContent).toContain('신고 유형');
    expect([...input.options].map((o) => [o.value, o.textContent])).toEqual(reasons);
    expect(input.value).toBe('OTHER');
    await detail('기존 기본 신고');
    await click('신고');
    expect(body()).toEqual({ sentenceVersionId: 'v1', reason: 'OTHER', detail: '기존 기본 신고' });
  });
  it.each(reasons)('posts %s and clears only detail on success', async (reason) => {
    await render();
    await select(reason);
    const input = await detail('확인해 주세요');
    await click('신고');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/reports');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(body()).toEqual({ sentenceVersionId: 'v1', reason, detail: '확인해 주세요' });
    expect(input.value).toBe('');
    expect(control<HTMLSelectElement>('select').value).toBe(reason);
    expect(control<HTMLTextAreaElement>('textarea').value).toBe('개인 기록');
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((c) => c.checked)).toEqual([true, true]);
  });
  it.each(['http', 'network'])('freezes pending report, retains %s failure inputs and retries identical payload', async (failure) => {
    let resolve!: (response: Response) => void;
    let reject!: (error: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
    await render();
    await select('AUDIO');
    const input = await detail('음원이 들리지 않습니다');
    await click('신고');
    expect(control<HTMLSelectElement>('select').disabled).toBe(true);
    expect(input.disabled).toBe(true);
    expect(button('저장').disabled).toBe(true);
    expect(button('신고 중').disabled).toBe(true);
    await click('신고 중');
    await click('저장');
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => failure === 'http' ? resolve(Response.json({ error: '실패' }, { status: 500 })) : reject(new Error('offline')));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(control<HTMLSelectElement>('select').value).toBe('AUDIO');
    expect(control<HTMLSelectElement>('select').disabled).toBe(false);
    expect(input.value).toBe('음원이 들리지 않습니다');
    await click('신고');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body(1)).toEqual(body());
    expect(input.value).toBe('');
    expect(control<HTMLSelectElement>('select').value).toBe('AUDIO');
  });
  it('preserves preference PATCH payload and blocks reporting during save', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((ok) => { resolve = ok; }));
    await render();
    await select('MEANING');
    const input = await detail('뜻 확인');
    await click('저장');
    await click('신고');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/sentence-preferences');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
    expect(body()).toEqual({ sentenceId: 's1', note: '개인 기록', hidden: true, selfReportedMemorized: true });
    await act(async () => resolve(Response.json({})));
    expect(input.value).toBe('뜻 확인');
    expect(control<HTMLSelectElement>('select').value).toBe('MEANING');
  });
  it('keeps empty-detail and missing-version report guards', async () => {
    await render();
    expect(button('신고').disabled).toBe(true);
    await detail('   ');
    await click('신고');
    expect(fetchMock).not.toHaveBeenCalled();
    await render(null);
    await detail('버전 없음');
    await click('신고');
    expect(button('신고').disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
