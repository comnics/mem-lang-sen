import Link from 'next/link';
import { AuthForm } from '@/features/learner/AuthForm';
import { Logo } from '@/components/Logo';
import { PageHeader } from '@/components/PageHeader';
import { DevLoginButtons } from '@/features/learner/DevLoginButtons';
import { devLoginEnabled } from '@/server/dev-login';

const reasonCopy: Record<string, string> = {
  expired: '인증 링크가 만료되었거나 이미 사용되었습니다. 메일을 다시 요청해 주세요.',
  setup: '서비스 연결 설정이 끝나면 로그인할 수 있습니다.',
  suspended: '계정 상태 확인이 필요합니다. 운영자에게 문의해 주세요.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;

  return (
    <main className="public-shell stack-lg">
      <nav className="topbar" aria-label="로그인 메뉴">
        <Logo />
        <Link className="button-secondary" href="/signup">가입</Link>
      </nav>
      <PageHeader eyebrow="다시 오신 것을 환영해요" title="로그인">
        오늘 학습과 내 문장 기록으로 이동합니다.
      </PageHeader>
      <AuthForm mode="signin" initialMessage={reason ? reasonCopy[reason] : null} />
      <Link className="button-ghost" href="/forgot-password">비밀번호를 잊으셨나요?</Link>
      {devLoginEnabled() ? <DevLoginButtons /> : null}
    </main>
  );
}
