// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudySessionClient } from '@/features/learner/StudySessionClient';
import { SignOutButton } from '@/features/learner/SignOutButton';
import { loadOutbox, saveOutboxItem } from '@/lib/outbox';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: 'a' }));

const session: ComponentProps<typeof StudySessionClient>['session'] = {
  id: 'session-a', userId: 'owner-a', setTitle: 'Test set', mode: 'WRITTEN', status: 'ACTIVE',
  timezone: 'Asia/Seoul', completedCount: 0,
  items: [1, 2].map((position) => ({ id: `item-${position}`, prompt: '한국어', meaning: '뜻', position, answered: false })),
};
const payload = { itemId: 'item-1', eventId: '54f3e850-5e42-4c8a-946f-15235d5128e5', answer: 'My frozen answer.', hard: true };
const result = { correct: true, result: 'CORRECT', target: payload.answer, acceptedAnswers: [payload.answer], explanation: 'Saved', completed: false, nextDueAt: null, reviewStep: 0, qualified: false, reviewReason: null };
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  router.refresh.mockClear();
  router.push.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function enqueue(body = payload, ownerId = session.userId) {
  saveOutboxItem({ ownerId, sessionId: session.id, payload: body, createdAt: Date.now() });
}
function queued(ownerId = session.userId) {
  return loadOutbox(ownerId, session.id);
}
async function render(props = session) {
  await act(async () => root.render(<StudySessionClient session={props} />));
}
async function reload(props = session) {
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(props);
}
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === label);
  expect(found, `button: ${label}`).toBeDefined();
  return found!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function respond(status: number, body: unknown = { error: 'Server message' }) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}
function sent(index = 0) {
  return JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body));
}

describe('study answer acknowledgement and reauthentication', () => {
  it('freezes a newly typed answer before its first 401 response', async () => {
    await render();
    await act(async () => {
      const textarea = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, payload.answer);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    respond(401);
    await click('제출');
    expect(fetchMock).toHaveBeenCalledOnce();
    const first = sent();
    expect(first).toMatchObject({ answer: payload.answer, hard: true, itemId: payload.itemId });
    expect(first.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(queued()[0]?.payload).toEqual(first);
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    respond(200, result);
    await click('같은 답안 다시 전송');
    expect(sent(1)).toEqual(first);
    expect(queued()).toEqual([]);
    expect(container.querySelector('a[href="/login"]')).toBeNull();
  });

  it.each(['WRITTEN', 'SPOKEN'] as const)('preserves %s payload, event id and frozen controls after 401 and reload', async (mode) => {
    const body = mode === 'WRITTEN' ? payload : { itemId: payload.itemId, eventId: payload.eventId, selfRating: 'GOOD' as const };
    saveOutboxItem({ ownerId: session.userId, sessionId: session.id, payload: body, createdAt: Date.now() });
    await render({ ...session, mode });
    respond(401);
    await click('대기 제출 다시 전송');
    expect(queued().map((entry) => entry.payload)).toEqual([body]);
    expect(container.textContent).toContain('같은 계정으로 다시 로그인');
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
    await reload({ ...session, mode });
    expect(queued().map((entry) => entry.payload)).toEqual([body]);
    respond(200, result);
    await click(mode === 'WRITTEN' ? '같은 답안 다시 전송' : '같은 확인 다시 전송');
    expect(sent(0)).toEqual(body);
    expect(sent(1)).toEqual(body);
    expect(queued()).toEqual([]);
    expect(container.textContent).not.toContain('저장 확인 대기 중인 제출');
  });

  it.each([408, 429, 500, 503])('keeps an unacknowledged %i response frozen across reload', async (status) => {
    enqueue();
    await render();
    respond(status);
    await click('같은 답안 다시 전송');
    expect(queued()[0]?.payload).toEqual(payload);
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    if (status === 429) expect(container.textContent).toContain('잠시 후');
    await reload();
    respond(200, result);
    await click('같은 답안 다시 전송');
    expect(sent(1)).toEqual(payload);
    expect(queued()).toEqual([]);
  });

  it('retains the same payload after network failure and response loss', async () => {
    enqueue();
    await render();
    fetchMock.mockRejectedValueOnce(new TypeError('Network failure'));
    await click('같은 답안 다시 전송');
    expect(queued()[0]?.payload).toEqual(payload);
    await reload();
    respond(200, result);
    await click('대기 제출 다시 전송');
    expect(sent(1)).toEqual(sent(0));
    expect(queued()).toEqual([]);
  });

  it.each([400, 403, 404, 422])('releases invalid/non-retryable %i submissions for correction', async (status) => {
    enqueue();
    await render();
    respond(status);
    await click('같은 답안 다시 전송');
    expect(queued()).toEqual([]);
    expect(container.querySelector('textarea')?.disabled).toBe(false);
    expect(container.textContent).toContain('Server message');
  });

  it('refreshes on conflict without retaining an already resolved submission', async () => {
    enqueue();
    await render();
    respond(409);
    await click('같은 답안 다시 전송');
    expect(queued()).toEqual([]);
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('textarea')?.disabled).toBe(false);
  });

  it.each([401, 408, 429])('pauses bulk replay on %i without deleting later events', async (status) => {
    enqueue();
    enqueue({ ...payload, itemId: 'item-2', eventId: 'other-event' });
    await render();
    respond(status);
    respond(status);
    await click('대기 제출 다시 전송');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queued()).toHaveLength(2);
  });

  it('uses the shared preservation policy when the browser comes online', async () => {
    enqueue();
    await render();
    respond(401);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(queued()[0]?.payload).toEqual(payload);
    expect(container.textContent).toContain('같은 계정으로 다시 로그인');
  });

  it('ignores duplicate clicks while the same answer is in flight', async () => {
    enqueue();
    await render();
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => {
      const retry = button('같은 답안 다시 전송');
      retry.click();
      retry.click();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => resolve(new Response(JSON.stringify(result), { status: 200 })));
    expect(queued()).toEqual([]);
  });

  it('does not replay another owner’s pending answers after switching accounts', async () => {
    enqueue();
    await render({ ...session, userId: 'owner-b' });
    expect(container.textContent).not.toContain('대기 제출 다시 전송');
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queued()[0]?.payload).toEqual(payload);
  });

  it('explicit logout still removes only the signing-out owner’s private outbox', async () => {
    enqueue();
    enqueue(payload, 'owner-b');
    await act(async () => root.render(<SignOutButton userId={session.userId} />));
    respond(200, { redirectTo: '/' });
    await click('로그아웃');
    expect(queued()).toEqual([]);
    expect(queued('owner-b')).toHaveLength(1);
    expect(router.push).toHaveBeenCalledWith('/');
  });
});
