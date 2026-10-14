import Link from 'next/link';
import { ArrowRight, BookOpenCheck, Mic, PencilLine } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { isConfigured } from '@/server/env';

export default function LandingPage() {
  const configured = isConfigured();

  return (
    <main className="public-shell stack-lg">
      <nav className="topbar" aria-label="공개 메뉴">
        <Logo />
        <Link className="button-secondary" href={configured ? '/login' : '#setup'}>
          로그인
        </Link>
      </nav>

      <section className="card stack-lg">
        <div className="page-heading">
          <span className="eyebrow">입력 회상과 말하기 자기확인</span>
          <h1 className="hero-title">오늘 쓸 문장을 먼저 떠올려 보세요.</h1>
          <p>
            문장정원은 정답을 바로 보여주지 않고, 직접 쓴 뒤 비교하는 작은 영어 학습 공간입니다.
            말하기는 스스로 확인한 기록으로 남겨 연습과 평가를 구분합니다.
          </p>
        </div>
        <div className="button-row">
          <Link className="button" href={configured ? '/signup' : '#setup'}>
            시작하기 <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link className="button-secondary" href="/demo">
            3문장 체험
          </Link>
        </div>
      </section>

      {!configured ? (
        <section className="notice" id="setup">
          <strong>서비스 연결 준비 중</strong>
          <p className="muted">
            현재 데이터베이스와 Supabase 공개 키 설정이 필요합니다. 설정 전에는 실제 로그인이나 개인 학습 기록을 만들 수 없습니다.
          </p>
        </section>
      ) : null}

      <section className="grid-2">
        <article className="card-quiet">
          <PencilLine size={22} aria-hidden="true" />
          <h2>정답 없이 먼저 쓰기</h2>
          <p className="muted">힌트나 답을 보기 전 입력한 첫 답만 채점 기록으로 남깁니다.</p>
        </article>
        <article className="card-quiet">
          <Mic size={22} aria-hidden="true" />
          <h2>말하기는 자기확인</h2>
          <p className="muted">소리 내어 말한 뒤 답을 열고, 다시 볼지 괜찮았는지만 표시합니다.</p>
        </article>
        <article className="card-quiet">
          <BookOpenCheck size={22} aria-hidden="true" />
          <h2>내 문장 기록</h2>
          <p className="muted">연습한 문장과 최근 결과를 모아 다음 학습을 고르기 쉽게 보여줍니다.</p>
        </article>
      </section>
    </main>
  );
}
