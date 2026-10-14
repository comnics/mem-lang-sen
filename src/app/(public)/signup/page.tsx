import Link from 'next/link';
import { AuthForm } from '@/features/learner/AuthForm';
import { Logo } from '@/components/Logo';
import { PageHeader } from '@/components/PageHeader';

export default function SignupPage() {
  return (
    <main className="public-shell stack-lg">
      <nav className="topbar" aria-label="가입 메뉴">
        <Logo />
        <Link className="button-secondary" href="/login">로그인</Link>
      </nav>
      <PageHeader eyebrow="새 학습 공간 만들기" title="가입">
        확인 메일을 보낸 뒤, 링크를 통해 문장정원을 시작합니다.
      </PageHeader>
      <AuthForm mode="signup" />
    </main>
  );
}
