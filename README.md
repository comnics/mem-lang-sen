# 문장정원 · Sentence Garden

필수 회화 문장을 세트로 선택하고, 정답을 가린 채 회상하고, 실제 제출 기록을 확인하는 모바일 웹입니다. 현재 구현 범위는 개발 계획의 **M0–M6**입니다.

- Next.js 16.4.0 / React 19.3 / TypeScript / Tailwind CSS
- PostgreSQL 17 / Prisma 7.10 / Supabase Auth·private Storage
- Vercel에 배포 가능한 단일 Next.js 앱, 사용자·관리자 화면 분리

## 로컬 실행

Node.js 24, pnpm 10.3, 실행 중인 Docker가 필요합니다. 첫 Supabase 시작은 컨테이너 다운로드로 시간이 걸립니다.

```sh
pnpm install --frozen-lockfile
pnpm local:start
pnpm local:setup
pnpm dev --hostname 127.0.0.1 --port 3100
```

`http://127.0.0.1:3100`에서 엽니다. 앱 실행에는 `APP_ORIGIN`이 필요하지 않습니다. 로컬 설정 스크립트는 로컬 Supabase만 허용하며, `.env.local`을 권한 0600으로 생성하고 migration·제한된 DB 역할·private bucket·테스트 계정·샘플을 준비합니다. 기존 사용자 학습 기록은 지우지 않습니다. 재실행하면 기존 로컬 런타임 DB 암호를 재사용합니다. 환경 변수를 변경한 경우 Next 서버를 다시 시작하세요.

| 로컬 계정 | 역할 | 비밀번호 |
|---|---|---|
| admin@example.test | 관리자 | LocalStudy!2026 |
| learner@example.test | 학습자 | LocalStudy!2026 |
| other@example.test | 격리 검증용 학습자 | LocalStudy!2026 |

이 계정은 로컬 시연 전용입니다. 회원가입 확인·비밀번호 재설정 메일은 `http://127.0.0.1:54324`의 로컬 메일함에서 확인합니다.

## 확인할 흐름

1. 비로그인 상태에서 `/demo`로 3문장 체험.
2. 관리자로 로그인 → `/admin/sentences`에서 문장·허용 답안·음원 등록 → `/admin/sets`에서 문장 순서 선택 → 검토 → 발행.
3. 사용자로 로그인 → 초기 설정 → `/sets`에서 세트 등록 → 입력 회상 또는 말하기 자기확인.
4. 힌트·답 보기는 서버에 노출 이력을 남깁니다. 이후 정답은 무도움 정답으로 집계하지 않습니다.
5. `/settings`에서 요일/N일 주기·시간대·날짜 예외를 설정하고 `/today`에서 자동 배정된 학습을 시작합니다. 밀린 복습이 있으면 새 문장을 줄이고, 7일 부재 후 복귀일은 최대 3분으로 시작합니다.
6. `/assessments`에서 주간 누적·응용 평가와 7일/30일 유지 평가를 시작합니다. 평가 첫 제출 전에는 정답이나 힌트를 볼 수 없습니다.
7. `/calendar`, `/history`, `/sentences`에서 학습 기록·복습 기한·개인 메모·자기 체크를 관리합니다. 자기 체크와 지연 회상 확인 이력은 별도로 표시합니다.
8. `/settings`에서 홈 화면 설치와 알림을 설정합니다. 답안 전송이 끊기면 같은 탭의 임시 보관 답안을 재전송하며 서버 확인 후에만 완료로 처리합니다.
9. 관리자는 `/admin/application-questions`, `/admin/reports`, `/admin/quality`에서 응용 문항 검수, 신고 처리, 품질 집계를 확인합니다.

CSV는 관리자 가져오기 화면에서 검증 후 원자적으로 저장합니다. 헤더와 예시는 [콘텐츠 운영 안내](docs/content.md)를 참고하세요. 샘플 25세트/144문장은 로컬 합성 음성 시연용이며, 상용 콘텐츠 언어·음원 검수를 대신하지 않습니다.

## 검증

```sh
pnpm exec playwright install chromium
pnpm verify:full
```

순서: ESLint → Prisma/Next 타입 생성·TypeScript → 도메인 단위 테스트 → 실제 PostgreSQL 통합 테스트 → 프로덕션 빌드 → 360px 모바일 브라우저 E2E. 통합/E2E는 로컬 Supabase와 `pnpm local:setup`을 요구합니다. `.github/workflows/verify.yml`은 격리된 로컬 Supabase를 이용해 같은 명령을 실행합니다.

```sh
pnpm local:stop
```

## 범위와 배포

M0 기반 UI·도구, M1 인증·DB, M2 관리자 콘텐츠, M3 첫 학습, M4 규칙 기반 복습·요일/N일 일정·날짜 예외·부담 조절을 포함합니다. M5의 주간·유지 평가와 학습 기록 관리, M6의 PWA 설치·선택적 푸시·답안 재전송도 포함합니다. 실제 기기 푸시와 Vercel/Supabase 호스팅 검증은 M7에서 진행합니다. 완전 오프라인 문장팩과 AI 발음 채점은 포함하지 않습니다. 학습 점수는 장기 암기 성공을 보장하지 않습니다.

- [Vercel + Supabase 배포 절차](docs/deployment.md)
- [M5·M6 구현·검증 결과](docs/m5-m6-implementation-status.md)
- [푸시 설정과 운영](docs/push.md)
- [M4 복습·일정 동작](docs/m4-review-scheduling.md)
- [M4 구현·검증 결과](docs/m4-implementation-status.md)
- [M0–M3 구현·검증 결과](docs/implementation-status.md)
- [구현 계약과 파일 경계](docs/m0-m3-contract.md)
- [디자인 기준](DESIGN.md)
- [전체 개발 계획](.omx/plans/implementation-plan-nextjs-supabase-2026-10-14.md)
