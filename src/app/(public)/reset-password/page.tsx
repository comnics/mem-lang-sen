import { AuthForm } from '@/features/learner/AuthForm';
import { Logo } from '@/components/Logo';
import { PageHeader } from '@/components/PageHeader';

export default function ResetPasswordPage() {
  return (
    <main className="public-shell stack-lg">
      <nav className="topbar" aria-label="비밀번호 변경 메뉴">
        <Logo />
      </nav>
      <PageHeader eyebrow="새 비밀번호" title="비밀번호 변경">
        메일 링크로 들어온 뒤 새 비밀번호를 저장합니다.
      </PageHeader>
      <AuthForm mode="update-password" />
    </main>
  );
}
