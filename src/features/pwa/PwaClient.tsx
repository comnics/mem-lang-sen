'use client';

import { useEffect, useState } from 'react';
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
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator;
  const pushSupported = supported && 'PushManager' in window && 'Notification' in window;

  useEffect(() => {
    if (!supported) return;
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setStandalone(true);
      setInstallEvent(null);
    };
    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayMode = () => setStandalone(isStandalone());
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('appinstalled', onInstalled);
    media.addEventListener('change', onDisplayMode);
    void refreshPush();
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener('change', onDisplayMode);
    };
  }, [supported]);


  async function refreshPush() {
    try {
      const response = await fetch('/api/v1/push-subscriptions');
      if (!response.ok) return;
      const settings = await response.json() as PushSettings;
      setPush(settings);
      setQuietStart(settings.quietStart ?? '');
      setQuietEnd(settings.quietEnd ?? '');
    } catch {
      setMessage('알림 설정을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.');
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
    if (!pushSupported || !push?.configured || !push?.publicKey) {
      setMessage('이 브라우저에서는 알림을 쓸 수 없습니다. 오늘 화면의 일정으로 학습을 이어가세요.');
      return;
    }
    setPending('push');
    setMessage(null);
    try {
      if (Notification.permission === 'denied') throw new Error('알림 권한이 차단되어 있습니다. 브라우저 설정에서 권한을 바꿔 주세요.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다. 오늘 화면의 일정으로 학습을 이어가세요.');
      const registration = await getOrRegisterServiceWorker();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(push.publicKey),
      });
      const response = await fetch('/api/v1/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? '알림 구독을 저장하지 못했습니다.');
      await patchPushSettings({ enabled: true, ...quietPatch(quietStart, quietEnd) });
      await refreshPush();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '알림을 켜지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function disablePush() {
    setPending('push');
    setMessage(null);
    let serverError: Error | null = null;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        try {
          await deletePushSubscription(subscription.endpoint);
        } catch (error) {
          serverError = error instanceof Error ? error : new Error('알림 구독을 서버에서 지우지 못했습니다.');
        }
        await subscription.unsubscribe().catch(() => undefined);
      }
      try {
        await patchPushSettings({ enabled: false, ...quietPatch(quietStart, quietEnd) });
      } catch (error) {
        serverError = error instanceof Error ? error : new Error('알림 설정을 끄지 못했습니다.');
      }
      await refreshPush();
      if (serverError) throw serverError;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '알림을 끄지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

  async function saveQuietHours() {
    setPending('quiet');
    setMessage(null);
    try {
      await patchPushSettings({ enabled: push?.enabled ?? false, ...quietPatch(quietStart, quietEnd) });
      await refreshPush();
      setMessage('알림 조용한 시간을 저장했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '조용한 시간을 저장하지 못했습니다.');
    } finally {
      setPending(null);
    }
  }

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
        <button className="button-secondary" type="button" onClick={install} disabled={!installEvent || standalone || Boolean(pending)}>
          {pending === 'install' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
          {standalone ? '설치됨' : '홈 화면 설치'}
        </button>
        {push?.enabled ? (
          <button className="button-ghost" type="button" onClick={disablePush} disabled={pending === 'push'}>
            <BellOff size={18} aria-hidden="true" /> 알림 끄기
          </button>
        ) : (
          <button className="button" type="button" onClick={enablePush} disabled={!pushSupported || !push?.configured || !push?.publicKey || pending === 'push'}>
            {pending === 'push' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
            알림 켜기
          </button>
        )}
      </div>
      <div className="grid-2">
        <label className="field">
          조용한 시간 시작
          <input className="input" type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} required />
        </label>
        <label className="field">
          조용한 시간 끝
          <input className="input" type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} required />
        </label>
      </div>
      <button className="button-secondary" type="button" onClick={saveQuietHours} disabled={pending === 'quiet'}>
        {pending === 'quiet' ? <Loader2 className="spin" size={18} aria-hidden="true" /> : null}
        조용한 시간 저장
      </button>
      <p className="muted">
        {standalone ? '앱처럼 열고 있습니다.' : 'iPhone은 공유 메뉴에서 홈 화면에 추가해 주세요.'} 알림이 없어도 오늘 화면의 일정이 기준입니다.
      </p>
      {!pushSupported ? <p className="notice">이 브라우저에서는 푸시 알림을 쓸 수 없습니다. 설치와 오늘 학습 일정은 계속 사용할 수 있습니다.</p> : null}
      {message ? <p className={message.includes('저장했습니다') ? 'notice notice-success' : 'notice notice-error'}>{message}</p> : null}
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
