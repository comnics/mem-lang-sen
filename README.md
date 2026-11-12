# 문장정원 · Sentence Garden

필수 영어 회화 문장을 정답을 가린 채 떠올리고, 반복 복습으로 익히는 모바일 웹 앱입니다.

- **학습** — 세트별 문장 학습, 입력 회상, 말하기 자기확인
- **복습** — 학습 일정과 부담 조절, 주간·유지 평가, 학습 기록 관리
- **콘텐츠 관리** — 문장·음원 등록, CSV 가져오기, 세트 검토·발행
- **모바일 지원** — 홈 화면 설치, 선택적 푸시 알림, 전송 실패 답안 재전송

Next.js · React · TypeScript · Tailwind CSS · Prisma · PostgreSQL · Supabase를 사용합니다.

## 로컬 실행

Node.js 24, pnpm 10.3, 실행 중인 Docker가 필요합니다.

```sh
pnpm install --frozen-lockfile
pnpm local:start
pnpm local:setup
pnpm dev --hostname 127.0.0.1 --port 3100
```

[http://127.0.0.1:3100](http://127.0.0.1:3100)에서 접속합니다. 첫 실행 시 Supabase 컨테이너 다운로드에 시간이 걸릴 수 있습니다.

`local:setup`은 로컬 Supabase에만 연결하며, `.env.local`과 DB·스토리지·테스트 계정·샘플 콘텐츠를 준비합니다. 재실행해도 기존 학습 기록은 유지합니다. 환경 변수를 변경했다면 개발 서버를 다시 시작하세요.

### 테스트 계정

모든 계정의 비밀번호는 `LocalStudy!2026`이며, 로컬 시연 전용입니다.

| 이메일 | 역할 |
| --- | --- |
| admin@example.test | 관리자 |
| learner@example.test | 학습자 |
| other@example.test | 사용자 간 데이터 격리 확인용 학습자 |

회원가입 확인·비밀번호 재설정 메일은 [로컬 메일함](http://127.0.0.1:54324)에서 확인합니다.

### 둘러보기

- **체험:** 로그인 없이 `/demo`에서 3문장을 학습합니다.
- **학습자:** `/sets`에서 세트를 등록하고 `/today`에서 학습합니다. `/settings`에서 일정을, `/assessments`에서 평가를 관리합니다.
- **관리자:** `/admin/sentences`에서 문장과 음원을 등록하고 `/admin/sets`에서 세트를 검토·발행합니다.

샘플 콘텐츠는 합성 음성을 사용하는 시연 자료입니다. 실제 서비스에 사용하려면 문장과 음원을 별도로 검수해야 합니다.

로컬 Supabase를 종료하려면 다음을 실행합니다.

```sh
pnpm local:stop
```

## 검증

로컬 Supabase를 시작하고 `pnpm local:setup`을 완료한 뒤 실행합니다.

```sh
pnpm exec playwright install chromium
pnpm verify:full
```

ESLint → 타입 검사 → 단위 테스트 → PostgreSQL 통합 테스트 → 프로덕션 빌드 → 모바일 브라우저 E2E 순서로 실행합니다. 통합·E2E 테스트는 로컬 전용이며 원격 DB를 대상으로 실행하지 않습니다.

## 관련 문서

| 문서 | 내용 |
| --- | --- |
| [배포 안내](docs/deployment.md) | Vercel·Supabase 설정, DB 준비, 인증 |
| [콘텐츠 운영](docs/content.md) | 문장·음원 관리, 세트 발행, CSV 형식 |
| [복습과 일정](docs/m4-review-scheduling.md) | 복습 규칙, 일정 설정, 학습량 조절 |
| [푸시 알림](docs/push.md) | 푸시 설정과 운영 |
| [디자인 기준](DESIGN.md) | 화면 구성과 UI 원칙 |

완전 오프라인 문장팩과 AI 발음 채점은 지원하지 않습니다. 실제 기기 푸시와 호스팅 환경의 동작은 별도 검증이 필요합니다.
