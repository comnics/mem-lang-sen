import Link from 'next/link';
import { AuthForm } from '@/features/learner/AuthForm';
import { Logo } from '@/components/Logo';
import { PageHeader } from '@/components/PageHeader';

export default function ForgotPasswordPage() {
  return (
    <main className="public-shell stack-lg">
      <nav className="topbar" aria-label="비밀번호 찾기 메뉴">
        <Logo />
        <Link className="button-secondary" href="/login">로그인</Link>
      </nav>
      <PageHeader eyebrow="계정 복구" title="비밀번호 재설정">
        등록된 이메일이면 새 비밀번호를 만들 수 있는 링크를 보내드립니다.
      </PageHeader>
      <AuthForm mode="forgot" />
    </main>
  );
}
