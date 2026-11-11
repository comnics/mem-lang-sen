'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Download, Loader2, WifiOff } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type PushSettings = {
  enabled: boolean;
  publicKey: string | null;
  configured: boolean;
  quietStart?: string | null;
  quietEnd?: string | null;
  subscriptions: { endpoint: string; enabled: boolean }[];
};

export function PwaClient() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(() => (typeof window !== 'undefined' ? isStandalone() : false));
  const [push, setPush] = useState<PushSettings | null>(null);
  const [device, setDevice] = useState<{ subscription: PushSubscription | null; permission: NotificationPermission; expired: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const refreshVersion = useRef(0);
  const mutating = useRef(false);
  const quietDirty = useRef(false);
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator;
  const pushSupported = supported && 'PushManager' in window && 'Notification' in window;

  const refreshPush = useCallback(async () => {
    const version = ++refreshVersion.current;
    setRefreshing(true);
    try {
      const response = await fetch('/api/v1/push-subscriptions');
      if (!response.ok) throw new Error('settings-unavailable');
      const settings = await response.json() as PushSettings;
      const registration = pushSupported ? await navigator.serviceWorker.getRegistration() : undefined;
      const subscription = await registration?.pushManager.getSubscription() ?? null;
      if (version !== refreshVersion.current) return;
      setPush(settings);
      setDevice({ subscription, permission: pushSupported ? Notification.permission : 'default', expired: Boolean(subscription && subscription.expirationTime !== null && subscription.expirationTime <= Date.now()) });
      if (!quietDirty.current) {
        setQuietStart(settings.quietStart ?? '');
        setQuietEnd(settings.quietEnd ?? '');
      }
    } catch {
      if (version !== refreshVersion.current) return;
      setPush(null);
      setDevice(null);
      setMessage('알림 설정을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.');
    } finally {
      if (version === refreshVersion.current) setRefreshing(false);
    }
  }, [pushSupported]);

  useEffect(() => {
    const resync = () => { if (!mutating.current) void refreshPush(); };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setStandalone(true); setInstallEvent(null); };
    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayMode = () => setStandalone(isStandalone());
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('appinstalled', onInstalled);
    media.addEventListener('change', onDisplayMode);
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', onVisible);
    let permissionStatus: PermissionStatus | undefined;
    let disposed = false;
    if (pushSupported && navigator.permissions) {
      void navigator.permissions.query({ name: 'notifications' }).then((status) => {
        if (disposed) return;
        permissionStatus = status;
        status.addEventListener('change', resync);
      }).catch(() => undefined); // Safari may not support this permission query.
    }
    // Start after effect setup; cleanup prevents Strict Mode's discarded setup from fetching.
    queueMicrotask(() => { if (!disposed) void refreshPush(); });
    return () => {
      disposed = true;
      refreshVersion.current += 1;
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener('change', onDisplayMode);
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', onVisible);
      permissionStatus?.removeEventListener('change', resync);
    };
  }, [pushSupported, refreshPush]);

  async function changePush(action: () => Promise<void>, success?: string) {
    if (mutating.current) return;
    mutating.current = true;
    refreshVersion.current += 1;
    setPending('push');
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '알림 설정을 변경하지 못했습니다.');
    } finally {
      await refreshPush();
      mutating.current = false;
      setPending(null);
    }
  }

  async function install() {
    if (!installEvent) return;
    setPending('install');
    setMessage(null);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
      setInstallEvent(null);
      setStandalone(choice.outcome === 'accepted' || isStandalone());
      if (choice.outcome !== 'accepted') setMessage('설치가 취소되었습니다. 브라우저 메뉴에서 다시 설치할 수 있습니다.');
    } finally {
      setPending(null);
    }
  }

  async function enablePush() {
    if (!pushSupported || !push?.configured || !push.publicKey) {
      setMessage('이 브라우저에서는 알림을 쓸 수 없습니다. 오늘 화면의 일정으로 학습을 이어가세요.');
      return;
    }
    await changePush(async () => {
      if (Notification.permission === 'denied') throw new Error('알림 권한이 차단되어 있습니다. 브라우저 설정에서 권한을 바꿔 주세요.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다. 오늘 화면의 일정으로 학습을 이어가세요.');
      const registration = await getOrRegisterServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && subscription.expirationTime !== null && subscription.expirationTime <= Date.now()) {
        // A replacement can have a different endpoint; free the old server device slot first.
        await deletePushSubscription(subscription.endpoint);
        if (!await subscription.unsubscribe()) throw new Error('만료된 기기 구독을 해지하지 못했습니다. 다시 시도해 주세요.');
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(push.publicKey!),
      });
      const response = await fetch('/api/v1/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? '알림 구독을 저장하지 못했습니다.');
      // Registration never changes the account-wide preference or quiet hours.
    });
  }

  async function disablePush() {
    await changePush(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await deletePushSubscription(subscription.endpoint);
        if (!await subscription.unsubscribe()) throw new Error('서버에서 해지했지만 브라우저 구독을 해지하지 못했습니다. 다시 시도해 주세요.');
      }
    });
  }

  async function saveQuietHours() {
    await changePush(async () => {
      await patchPushSettings(quietPatch(quietStart, quietEnd));
      quietDirty.current = false;
    }, '알림 조용한 시간을 저장했습니다.');
  }

  const busy = Boolean(pending) || refreshing;
  const subscription = device?.subscription;
  const deviceEnabled = device?.permission === 'granted' && subscription &&
    !device.expired &&
    push?.subscriptions.some((entry) => entry.endpoint === subscription.endpoint && entry.enabled);

  return (
    <section className="card stack">
      <div className="split-row">
        <div>
          <span className="badge">PWA</span>
          <h2>설치와 알림</h2>
        </div>
        {supported ? <Download size={20} aria-hidden="true" /> : <WifiOff size={20} aria-hidden="true" />}
      </div>
      <div className="button-row">
        <button className="button-secondary" type="button" onClick={install} disabled={!installEvent || standalone || busy}>
          {pending === 'install' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
          {standalone ? '설치됨' : '홈 화면 설치'}
        </button>
        {!deviceEnabled ? (
          <button className="button" type="button" onClick={enablePush} disabled={!pushSupported || !push || !device || !push.configured || !push.publicKey || busy}>
            {pending === 'push' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
            이 기기 알림 켜기
          </button>
        ) : <span className="badge">이 기기 알림 등록됨</span>}
        {subscription ? (
          <button className="button-ghost" type="button" onClick={disablePush} disabled={busy || !push}>
            <BellOff size={18} aria-hidden="true" /> 이 기기만 알림 해지
          </button>
        ) : null}
        <button className="button-secondary" type="button" disabled={!push || busy} onClick={() => changePush(() => patchPushSettings({ enabled: !push?.enabled }))}>
          {push?.enabled ? '계정 전체 알림 중지' : '계정 전체 알림 켜기'}
        </button>
        <button className="button-ghost" type="button" disabled={busy} onClick={() => { setMessage(null); void refreshPush(); }}>알림 상태 새로고침</button>
      </div>
      {push && !push.enabled ? <p className="notice">계정 전체 알림이 중지되어 있습니다. 기기를 등록해도 알림을 받으려면 계정 전체 알림을 켜 주세요.</p> : null}
      {device?.permission === 'denied' ? <p className="notice">알림 권한이 차단되어 있습니다. 브라우저 설정에서 권한을 바꿔 주세요.</p> : null}
      <p className="muted">기기 등록·해지는 다른 기기와 계정 전체 설정을 바꾸지 않습니다. 계정 전체 중지는 등록된 모든 기기의 발송을 중지합니다.</p>
      <div className="grid-2">
        <label className="field">
          조용한 시간 시작
          <input className="input" type="time" value={quietStart} onChange={(event) => { quietDirty.current = true; setQuietStart(event.target.value); }} disabled={Boolean(pending)} required />
        </label>
        <label className="field">
          조용한 시간 끝
          <input className="input" type="time" value={quietEnd} onChange={(event) => { quietDirty.current = true; setQuietEnd(event.target.value); }} disabled={Boolean(pending)} required />
        </label>
      </div>
      <button className="button-secondary" type="button" onClick={saveQuietHours} disabled={!push || busy}>
        조용한 시간 저장
      </button>
      <p className="muted">
        {standalone ? '앱처럼 열고 있습니다.' : 'iPhone은 공유 메뉴에서 홈 화면에 추가해 주세요.'} 알림이 없어도 오늘 화면의 일정이 기준입니다.
      </p>
      {!pushSupported ? <p className="notice">이 브라우저에서는 푸시 알림을 쓸 수 없습니다. 설치와 오늘 학습 일정은 계속 사용할 수 있습니다.</p> : null}
      {message ? <p role="status" className={message.includes('저장했습니다') ? 'notice notice-success' : 'notice notice-error'}>{message}</p> : null}
    </section>
  );
}

async function patchPushSettings(body: { enabled?: boolean; quietStart?: string; quietEnd?: string }) {
  const response = await fetch('/api/v1/push-subscriptions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? '알림 설정을 저장하지 못했습니다.');
}

async function deletePushSubscription(endpoint: string) {
  const response = await fetch('/api/v1/push-subscriptions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? '알림 구독을 서버에서 지우지 못했습니다.');
}

async function getOrRegisterServiceWorker() {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

function quietPatch(quietStart: string, quietEnd: string) {
  if (!quietStart || !quietEnd) throw new Error('조용한 시간은 시작과 끝을 모두 HH:mm 형식으로 입력해 주세요.');
  return { quietStart, quietEnd };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}
