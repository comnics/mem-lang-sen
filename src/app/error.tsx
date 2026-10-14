'use client';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="public-shell stack-lg"><section className="card stack" role="alert"><h1>잠시 연결이 어려워요</h1><p>저장된 기록은 유지됩니다. 연결을 확인한 뒤 다시 시도해 주세요.</p><button className="button" onClick={reset}>다시 시도</button></section></main>;
}
