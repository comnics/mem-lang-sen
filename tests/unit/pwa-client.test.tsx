// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaClient } from '@/features/pwa/PwaClient';

const endpointA = 'https://fcm.googleapis.com/device-a';
const endpointB = 'https://fcm.googleapis.com/device-b';
let root: Root;
let container: HTMLDivElement;
let settings: { enabled: boolean; configured: boolean; publicKey: string; quietStart: string; quietEnd: string; subscriptions: { endpoint: string; enabled: boolean }[] };
let permission: NotificationPermission;
let subscription: PushSubscription | null;
let getSubscription: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn<(url: string, options?: RequestInit) => Promise<Response>>>;
let permissionStatus: EventTarget;
let failMethod: string | null;

function device(expirationTime: number | null = null): PushSubscription {
  return { endpoint: endpointB, expirationTime, unsubscribe, toJSON: () => ({ endpoint: endpointB, keys: { p256dh: 'test-key', auth: 'test-auth' } }) } as unknown as PushSubscription;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  settings = { enabled: true, configured: true, publicKey: 'BAAA', quietStart: '22:00', quietEnd: '08:00', subscriptions: [{ endpoint: endpointA, enabled: true }] };
  permission = 'granted';
  subscription = null;
  failMethod = null;
  permissionStatus = new EventTarget();
  unsubscribe = vi.fn(async () => { subscription = null; return true; });
  getSubscription = vi.fn(async () => subscription);
  subscribe = vi.fn(async () => { subscription = device(); return subscription; });
  const registration = { pushManager: { getSubscription, subscribe } };
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { get permission() { return permission; }, requestPermission: vi.fn(async () => permission) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: vi.fn(async () => registration), register: vi.fn(async () => registration) } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn(async () => permissionStatus) } });
  fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET';
    if (method === failMethod) return Response.json({ error: 'Network operation failed' }, { status: 503 });
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (method === 'POST') settings.subscriptions = [...settings.subscriptions.filter((s) => s.endpoint !== body.endpoint), { endpoint: body.endpoint, enabled: true }];
    if (method === 'DELETE') settings.subscriptions = settings.subscriptions.filter((s) => s.endpoint !== body.endpoint);
    if (method === 'PATCH') Object.assign(settings, body);
    return Response.json(method === 'GET' ? settings : { ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'permissions');
  vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(<PwaClient />)); }
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(found, label).toBeDefined();
  return found!;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function focus() { await act(async () => window.dispatchEvent(new Event('focus'))); }
function writes() { return fetchMock.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET').map(([, options]) => ({ method: options!.method, body: JSON.parse(String(options!.body)) })); }

describe('device subscriptions are distinct from account notification preference', () => {
  it('offers registration on B while A and the account remain enabled', async () => {
    await render();
    expect(getSubscription).toHaveBeenCalled();
    expect(button('이 기기 알림 켜기').disabled).toBe(false);
    await click('이 기기 알림 켜기');
    expect(settings.subscriptions).toEqual([{ endpoint: endpointA, enabled: true }, { endpoint: endpointB, enabled: true }]);
    expect(settings.enabled).toBe(true);
    expect(writes().map((w) => w.method)).toEqual(['POST']);
    expect(button('이 기기만 알림 해지')).toBeDefined();
  });
  it('registers a device without resuming an account-wide pause', async () => {
    settings.enabled = false;
    await render();
    await click('이 기기 알림 켜기');
    expect(settings.enabled).toBe(false);
    expect(container.textContent).toContain('계정 전체 알림이 중지되어 있습니다');
    await click('계정 전체 알림 켜기');
    expect(settings.enabled).toBe(true);
    expect(writes().at(-1)).toEqual({ method: 'PATCH', body: { enabled: true } });
  });
  it('removes only B without changing A or the account preference', async () => {
    subscription = device();
    settings.subscriptions.push({ endpoint: endpointB, enabled: true });
    await render();
    await click('이 기기만 알림 해지');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(settings.subscriptions).toEqual([{ endpoint: endpointA, enabled: true }]);
    expect(settings.enabled).toBe(true);
    expect(writes()).toEqual([{ method: 'DELETE', body: { endpoint: endpointB } }]);
    expect(button('이 기기 알림 켜기')).toBeDefined();
  });
  it('pauses all devices without deleting or unsubscribing either device', async () => {
    subscription = device();
    settings.subscriptions.push({ endpoint: endpointB, enabled: true });
    await render();
    await click('계정 전체 알림 중지');
    expect(settings.enabled).toBe(false);
    expect(settings.subscriptions).toHaveLength(2);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(writes()).toEqual([{ method: 'PATCH', body: { enabled: false } }]);
  });
  it.each(['missing', 'disabled', 'expired'] as const)('repairs %s browser/server state without altering account settings', async (state) => {
    subscription = device(state === 'expired' ? Date.now() - 1000 : null);
    if (state !== 'missing') settings.subscriptions.push({ endpoint: endpointB, enabled: state === 'expired' });
    await render();
    await click('이 기기 알림 켜기');
    expect(settings.subscriptions.find((s) => s.endpoint === endpointB)?.enabled).toBe(true);
    expect(subscribe).toHaveBeenCalledTimes(state === 'expired' ? 1 : 0);
    expect(unsubscribe).toHaveBeenCalledTimes(state === 'expired' ? 1 : 0);
    expect(writes().map((w) => w.method)).toEqual(state === 'expired' ? ['DELETE', 'POST'] : ['POST']);
  });
  it('detects subscription expiration and removal when returning to the page', async () => {
    subscription = device();
    settings.subscriptions.push({ endpoint: endpointB, enabled: true });
    await render();
    subscription = null;
    await focus();
    expect(button('이 기기 알림 켜기').disabled).toBe(false);
    expect(writes()).toEqual([]);
  });
  it('resyncs permission changes without silently subscribing or changing the account', async () => {
    subscription = device();
    settings.subscriptions.push({ endpoint: endpointB, enabled: true });
    await render();
    permission = 'denied';
    await act(async () => permissionStatus.dispatchEvent(new Event('change')));
    expect(container.textContent).toContain('알림 권한이 차단되어 있습니다');
    await click('이 기기 알림 켜기');
    expect(subscribe).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    permission = 'granted';
    await focus();
    expect(button('이 기기만 알림 해지')).toBeDefined();
  });
  it('preserves browser subscription when server deletion fails', async () => {
    subscription = device();
    settings.subscriptions.push({ endpoint: endpointB, enabled: true });
    await render();
    failMethod = 'DELETE';
    await click('이 기기만 알림 해지');
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(settings.enabled).toBe(true);
    expect(container.textContent).toContain('Network operation failed');
  });
  it('does not mark B registered after POST failure and supports retry', async () => {
    await render();
    failMethod = 'POST';
    await click('이 기기 알림 켜기');
    expect(button('이 기기 알림 켜기').disabled).toBe(false);
    failMethod = null;
    await click('이 기기 알림 켜기');
    expect(settings.subscriptions).toHaveLength(2);
    expect(subscribe).toHaveBeenCalledOnce();
  });
  it('quiet-hour saves never carry a stale account enabled value', async () => {
    await render();
    settings.enabled = false; // another device paused the account after the GET
    await click('조용한 시간 저장');
    expect(writes()).toEqual([{ method: 'PATCH', body: { quietStart: '22:00', quietEnd: '08:00' } }]);
    expect(settings.enabled).toBe(false);
  });
  it('shows failed refresh and disables stale controls until retry succeeds', async () => {
    await render();
    failMethod = 'GET';
    await focus();
    expect(button('이 기기 알림 켜기').disabled).toBe(true);
    expect(container.textContent).toContain('알림 설정을 불러오지 못했습니다');
    failMethod = null;
    await click('알림 상태 새로고침');
    expect(button('이 기기 알림 켜기').disabled).toBe(false);
  });
  it('keeps device registration disabled on unsupported browsers but allows account control', async () => {
    Reflect.deleteProperty(window, 'PushManager');
    await render();
    expect(button('이 기기 알림 켜기').disabled).toBe(true);
    await click('계정 전체 알림 중지');
    expect(settings.enabled).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });
  it('does not subscribe when the permission prompt is dismissed', async () => {
    permission = 'default';
    await render();
    await click('이 기기 알림 켜기');
    expect(writes()).toEqual([]);
    expect(subscribe).not.toHaveBeenCalled();
    expect(container.textContent).toContain('알림 권한이 허용되지 않았습니다');
  });
  it('resyncs provider-disabled subscriptions on visibility return', async () => {
    subscription = device();
    settings.subscriptions.push({ endpoint: endpointB, enabled: true });
    await render();
    settings.subscriptions[1].enabled = false;
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(button('이 기기 알림 켜기').disabled).toBe(false);
    expect(writes()).toEqual([]);
  });
  it('ignores an older refresh response that arrives after the latest one', async () => {
    await render();
    let resolveOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }));
    await focus();
    const stale = structuredClone(settings);
    settings.enabled = false;
    await focus();
    await act(async () => resolveOld(Response.json(stale)));
    expect(button('계정 전체 알림 켜기')).toBeDefined();
    expect(button('이 기기 알림 켜기').disabled).toBe(false);
  });
  it('does not allow competing writes or focus refreshes during registration', async () => {
    await render();
    let finish!: () => void;
    subscribe.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      subscription = device();
      return subscription;
    });
    await click('이 기기 알림 켜기');
    expect(button('계정 전체 알림 중지').disabled).toBe(true);
    expect(button('조용한 시간 저장').disabled).toBe(true);
    const calls = fetchMock.mock.calls.length;
    await focus();
    expect(fetchMock.mock.calls).toHaveLength(calls);
    await act(async () => finish());
    expect(writes().map((w) => w.method)).toEqual(['POST']);
  });
  it('reports partial browser unsubscribe failure and lets the user retry', async () => {
    subscription = device();
    settings.subscriptions.push({ endpoint: endpointB, enabled: true });
    unsubscribe.mockResolvedValueOnce(false);
    await render();
    await click('이 기기만 알림 해지');
    expect(container.textContent).toContain('브라우저 구독을 해지하지 못했습니다');
    expect(settings.enabled).toBe(true);
    expect(button('이 기기 알림 켜기')).toBeDefined();
    await click('이 기기만 알림 해지');
    expect(subscription).toBeNull();
  });
  it('replaces an expired endpoint at the device limit without losing A', async () => {
    subscription = device(Date.now() - 1);
    settings.subscriptions.push({ endpoint: endpointB, enabled: true });
    for (let i = 0; i < 8; i++) settings.subscriptions.push({ endpoint: `https://fcm.googleapis.com/other-${i}`, enabled: true });
    const replacement = 'https://fcm.googleapis.com/replacement';
    subscribe.mockImplementationOnce(async () => {
      subscription = { ...device(), endpoint: replacement, toJSON: () => ({ endpoint: replacement, keys: { p256dh: 'test-key', auth: 'test-auth' } }) } as PushSubscription;
      return subscription;
    });
    const server = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === 'POST' && settings.subscriptions.length >= 10) return Response.json({ error: 'device limit' }, { status: 409 });
      return server(url, options);
    });
    await render();
    await click('이 기기 알림 켜기');
    expect(writes()).toEqual([
      { method: 'DELETE', body: { endpoint: endpointB } },
      { method: 'POST', body: { endpoint: replacement, keys: { p256dh: 'test-key', auth: 'test-auth' } } },
    ]);
    expect(settings.subscriptions).toHaveLength(10);
    expect(settings.subscriptions).toContainEqual({ endpoint: endpointA, enabled: true });
    expect(settings.subscriptions).toContainEqual({ endpoint: replacement, enabled: true });
    expect(settings.enabled).toBe(true);
    expect(container.textContent).toContain('이 기기 알림 등록됨');
  });
  it('preserves unsaved quiet-hour edits across focus and device changes', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="time"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '21:00');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await focus();
    await click('이 기기 알림 켜기');
    expect(input.value).toBe('21:00');
    await click('조용한 시간 저장');
    expect(settings.quietStart).toBe('21:00');
    settings.quietStart = '20:00';
    await focus();
    expect(input.value).toBe('20:00');
  });
});
