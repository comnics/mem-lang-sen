# Vercel + Supabase 배포

M0–M6는 한 Next.js 앱으로 배포합니다. 현재 저장소의 로컬 검증과 실제 호스팅 검증은 별개입니다. 이 구현 작업에서 외부 프로젝트를 생성하거나 운영 배포하지 않습니다.

## 1. 환경 분리와 버전

개발/스테이징/운영 Supabase 프로젝트를 분리합니다. Vercel Preview에 운영 DB를 연결하지 않습니다. Node.js 24와 lockfile의 Next.js/Prisma 버전을 사용하세요. 착수 시 npm의 Next 안정 버전은 16.4.0이었습니다. 배포 전 공식 보안 공지와 최신 안정 패치를 다시 확인하고 패치 변경 후 전체 검증을 실행합니다. Prisma는 CLI·Client·pg adapter를 같은 7.10.0으로 고정했습니다.

## 2. DB와 Storage 준비

Supabase 프로젝트의 PostgreSQL 버전을 로컬 `supabase/config.toml`과 맞춥니다. 앱 데이터는 `app` 스키마에만 저장합니다. Supabase Data API 노출 스키마에 `app`을 추가하지 않습니다.

관리 작업 환경에 `.env.example`의 변수를 설정합니다.

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 해당 환경 Supabase API 주소 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 브라우저용 publishable key |
| `SUPABASE_SECRET_KEY` | 서버 전용 Auth/Storage 관리 키 |
| `DATABASE_URL` | app_runtime 역할의 transaction pooler URL |
| `DIRECT_URL` | migration 관리자 direct 또는 session pooler URL |

Supabase Dashboard Connect에서 실제 호스트/프로젝트 ref를 복사합니다. 서버리스 런타임은 transaction pooling(통상 6543), migration은 direct 또는 session pooling(5432)을 사용합니다. 런타임 URL의 사용자 부분은 `app_runtime.<project-ref>`, 암호는 새로 생성한 24자 이상의 랜덤 값입니다. URL 예약문자는 인코딩합니다. TLS 인증서 검증을 끄지 않습니다. [Supabase 연결 안내](https://supabase.com/docs/guides/database/connecting-to-postgres).

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm platform:setup
```

`platform:setup`은 해당 DB에 제한된 app_runtime 역할과 DML 권한, private `sentence-audio` bucket을 멱등 구성합니다. DB 비밀번호는 `DATABASE_URL`의 값으로 설정합니다. 같은 대상에 병렬 실행하지 않습니다. 플랫폼 설정과 Prisma migration이 같은 테이블을 중복 관리하지 않습니다. 앱은 요청마다 서버에서 Auth ID와 DB의 현재 역할/상태/소유자를 검사합니다. Auth JWT가 Prisma에 자동 전파되는 RLS 설계가 아닙니다.

`DIRECT_URL`은 migration 작업 환경에만 보관합니다. Vercel 일반 런타임에는 넣지 않습니다. 빌드는 migration 없이 Prisma generate와 next build만 수행합니다. 예시 계정이 생기는 `local:setup`은 운영에서 실행하지 않습니다. 콘텐츠만 반영하는 원격 시드는 아래 절차로 실행합니다.

## 3. Auth

Supabase Auth에서 이메일/비밀번호 로그인·이메일 확인을 켜고 최소 비밀번호 길이를 10으로 설정합니다. Site URL은 대표 서비스 주소로 설정하고, redirect allowlist는 `/auth/callback` 및 `/auth/callback?next=/reset-password`의 정확한 서비스 URL을 등록합니다. 운영 allowlist에 광범위한 wildcard를 사용하지 않습니다.

이메일 템플릿은 `supabase/templates/confirmation.html`과 `recovery.html`을 적용합니다. 토큰 해시를 `/auth/confirm`에서 검증하고 세션 쿠키를 설정합니다. 실제 SMTP 발송자·도메인을 설정한 뒤 회원가입/재설정/만료 링크를 스테이징에서 확인합니다. 로컬 메일함은 실제 SMTP 검증을 대신하지 않습니다.

최초 관리자 계정은 일반 가입과 이메일 확인을 완료한 뒤, 운영자가 Auth UUID를 지정합니다.

```sh
pnpm admin:grant <확인된-Auth-사용자-UUID>
```

Auth 사용자 metadata의 role 값은 권한으로 사용하지 않습니다. DB에서 ADMIN→USER 또는 ACTIVE→SUSPENDED로 변경하면 후속 서버 요청에서 차단됩니다. 로그아웃은 브라우저 쿠키와 Supabase 세션을 정리하지만, 이미 발행한 access token의 만료 동작은 Supabase 정책을 따릅니다.

## 4. Vercel

Framework: Next.js, Node: 24, Install: `pnpm install --frozen-lockfile`, Build: `pnpm build`. Preview/Production 각각 해당 환경의 런타임 변수를 설정합니다. DB와 Vercel 함수 지역은 가까운 지역을 선택합니다. 외부 음원은 클라이언트가 서명된 Storage 업로드 주소로 직접 전송하므로 Vercel body 제한에 의존하지 않습니다.

스테이징에서 반드시 확인할 항목:

- HTTPS 쿠키 갱신, 가입 확인, 재설정, 로그아웃, 권한 회수
- 실제 transaction pooler를 통한 병렬 학습 제출과 원자성
- 음원 업로드/완료 검증/서명 URL 재생과 만료
- 사용자 간 이력·세션 격리, 답안 공개 전 HTML/RSC/JSON에 정답 없음
- 모바일 Safari/Chrome 키보드·오디오·뒤로가기와 360px 화면
- migration 적용 전 백업과 이전 앱 버전으로의 호환성

동일 운영 DB에 migration을 직렬 적용하고 완료 후 앱을 배포합니다. 앱 롤백은 DB 롤백이 아니며, 파괴적 down migration을 자동 실행하지 않습니다. M4 오늘 대기열은 요청 시 계산하므로 Cron에 의존하지 않습니다. M6 서비스워커는 공개 오프라인 안내와 아이콘만 캐시합니다. 선택적 푸시 발송은 [푸시 운영 안내](push.md)의 VAPID·환경 플래그·사용자 동의·Supabase Cron 설정을 모두 요구합니다. 스테이징은 명시한 테스트 사용자만 허용하고 Vercel Preview에서는 발송하지 않습니다. 실제 기기 푸시와 Cron 연결은 별도 스테이징 검증이 필요합니다.

## 원격 콘텐츠 시드

`.env.local`의 DB 두 URL과 Supabase URL/공개 키/서버 키를 모두 같은 프로젝트로 맞춘다. DB URL은 `sslmode=verify-full`과 신뢰할 수 있는 CA를 사용한다(`certs/README.md`). `DATABASE_URL`은 전용 `app_runtime` 계정, `DIRECT_URL`은 마이그레이션 관리자 계정이다.

```sh
pnpm db:migrate
# Auth/Storage 설정 전에는 DB 계정만 준비할 수 있다.
pnpm platform:setup --database-only
# 아래 PROJECT_REF를 실제 Supabase 프로젝트 ID로 교체한다.
pnpm platform:setup --remote-project=PROJECT_REF
pnpm db:seed --remote-project=PROJECT_REF
```

원격 시드는 기본 차단되며 명시한 프로젝트와 DB·Auth/Storage 주소가 일치해야 한다. 콘텐츠 25세트/144문장과 음원을 추가하며 데모 로그인 계정을 생성하지 않는다. 같은 콘텐츠로 재실행해도 기존 학습 기록을 초기화하지 않는다. `local:setup`은 원격 환경에서 사용하지 않는다. 원격 URL로 바꾼 뒤 앱을 다시 빌드/시작한다. 기존 통합/E2E 테스트는 로컬 전용이므로 원격 DB를 대상으로 실행하지 않는다.

## 개발용 빠른 로그인

`pnpm dev --hostname 127.0.0.1 --port 3100` 실행 시 로그인 화면 하단에 사용자/관리자 버튼이 표시된다. `APP_ORIGIN` 설정은 필요하지 않다. 가입·복구 링크와 인증 후 이동 주소는 요청 대상 주소를 사용한다.

서버 전용 `DEV_LOGIN_USER_EMAIL`, `DEV_LOGIN_USER_PASSWORD`, `DEV_LOGIN_ADMIN_EMAIL`, `DEV_LOGIN_ADMIN_PASSWORD`에 각 테스트 계정 정보를 설정한다. 계정은 Supabase Auth에 존재해야 하며 `app.AppUser`의 실제 역할이 각각 `USER`, `ADMIN`이고 활성 상태여야 한다. 버튼은 계정 생성이나 권한 변경을 하지 않는다. 비밀번호를 클라이언트로 전달하지 않으며 일반 비밀번호 로그인으로 세션을 발급한다.

`NODE_ENV=development`, Vercel 외부 실행 조건에서만 활성화된다. 프로덕션 빌드에서는 버튼을 숨기고 API도 차단한다. 개발 서버는 루프백 주소에 바인딩해 사용한다. 현재 연결된 Supabase에 개발 전용 사용자/관리자 계정 2개를 준비했으며, 해당 계정의 학습·관리 작업은 그 프로젝트에 실제 저장된다.


## 접속 주소 자동 처리

Vercel에 `APP_ORIGIN`을 등록하지 않는다. API는 Origin 헤더의 유무나 값으로 요청을 차단하지 않으며, 기존 Origin 기반 CSRF 검사는 제거했다. 인증·역할·소유권·JSON 입력 검사는 유지한다. 이는 브라우저의 CORS 정책을 모든 외부 사이트에 개방하는 설정은 아니다. 인증 링크는 요청 대상 Host와 프로토콜을 사용하고, Vercel에서는 HTTPS를 사용한다. Supabase의 Site URL과 Redirect URLs는 별도 설정이며 사용하는 배포 주소를 등록해야 한다.
