# Vercel + Supabase 배포

M0–M4는 한 Next.js 앱으로 배포합니다. 현재 저장소의 로컬 검증과 실제 호스팅 검증은 별개입니다. 이 구현 작업에서 외부 프로젝트를 생성하거나 운영 배포하지 않습니다.

## 1. 환경 분리와 버전

개발/스테이징/운영 Supabase 프로젝트를 분리합니다. Vercel Preview에 운영 DB를 연결하지 않습니다. Node.js 24와 lockfile의 Next.js/Prisma 버전을 사용하세요. 착수 시 npm의 Next 안정 버전은 16.4.0이었습니다. 배포 전 공식 보안 공지와 최신 안정 패치를 다시 확인하고 패치 변경 후 전체 검증을 실행합니다. Prisma는 CLI·Client·pg adapter를 같은 7.10.0으로 고정했습니다.

## 2. DB와 Storage 준비

Supabase 프로젝트의 PostgreSQL 버전을 로컬 `supabase/config.toml`과 맞춥니다. 앱 데이터는 `app` 스키마에만 저장합니다. Supabase Data API 노출 스키마에 `app`을 추가하지 않습니다.

관리 작업 환경에 `.env.example`의 변수를 설정합니다.

| 변수 | 용도 |
|---|---|
| `APP_ORIGIN` | HTTPS 서비스 origin, 끝 슬래시 없는 값 |
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

`DIRECT_URL`은 migration 작업 환경에만 보관합니다. Vercel 일반 런타임에는 넣지 않습니다. 빌드는 migration 없이 Prisma generate와 next build만 수행합니다. 예시 계정이 생기는 `local:setup`/demo seed는 운영에서 실행하지 않습니다.

## 3. Auth

Supabase Auth에서 이메일/비밀번호 로그인·이메일 확인을 켜고 최소 비밀번호 길이를 10으로 설정합니다. Site URL은 APP_ORIGIN, redirect allowlist는 `/auth/callback` 및 `/auth/callback?next=/reset-password`의 정확한 서비스 URL을 등록합니다. 운영 allowlist에 광범위한 wildcard를 사용하지 않습니다.

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

동일 운영 DB에 migration을 직렬 적용하고 완료 후 앱을 배포합니다. 앱 롤백은 DB 롤백이 아니며, 파괴적 down migration을 자동 실행하지 않습니다. M4 오늘 대기열은 요청 시 계산하므로 Cron에 의존하지 않습니다. Cron·push·서비스워커는 M6 이후 구현 범위라 이번 배포에 없습니다.
