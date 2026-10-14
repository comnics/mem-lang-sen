# M0–M3 구현 결과

검증일: 2026-10-14. 실제 구현 및 로컬 검증 결과이며, 외부 호스팅 배포 결과는 포함하지 않습니다.

이 문서는 M0–M3 완료 당시의 기록입니다. 이후 구현한 M4의 현재 상태는 [M4 구현·검증 결과](m4-implementation-status.md)를 참고하세요.

## 구현 범위

| 단계 | 구현 결과 | 주요 파일 |
|---|---|---|
| M0 기반 | Next.js 16.4.0, React 19.3, TypeScript, Tailwind, 모바일 사용자 화면과 별도 관리자 화면, CI 명령 | `package.json`, `src/app`, `DESIGN.md`, `.github/workflows/verify.yml` |
| M1 데이터·인증 | Prisma 7.10/PostgreSQL, Supabase 이메일 인증·재설정·로그아웃, 현재 DB 역할/상태 검사, 제한된 런타임 역할, 로컬 초기화 | `prisma/schema.prisma`, `prisma/migrations`, `src/server/auth.ts`, `scripts/local-setup.ts` |
| M2 콘텐츠 | 문장 버전·허용 답안, 순서 있는 세트, 초안→검토→발행→보관, 복제, CSV 원자적 가져오기, private 음원 업로드/검증, 관리자 미리보기 | `src/features/admin`, `src/server/services/content.ts`, `src/domain/csv.ts` |
| M3 첫 학습 | 세트 선택/등록, 초기 설정, 서버 발급 세션, 정답을 가린 입력 회상, 말하기 자기확인, 힌트/답 노출 기록, 최초 제출 채점, 내 문장/학습 이력 | `src/features/learner`, `src/server/services/learning.ts`, `src/domain/grading.ts` |

문장 정답은 제출 또는 답 보기 전의 학습 HTML/JSON에 포함하지 않습니다. 힌트나 답을 본 제출은 도움 후 답으로 구분하며, 말하기는 정답 판정 대신 자기확인으로 기록합니다. 최초 제출 응답이 유실되면 같은 이벤트와 같은 답안을 재전송하여 중복 집계를 막습니다. 여러 세트에서 공유되는 문장의 학습 상태는 사용자·문장·학습 방식 단위로 관리합니다.

로컬 샘플은 2세트/6문장과 실제 WAV 합성 음원입니다. 공개된 문장 버전은 수정하지 않고 새 버전을 생성합니다. 검토·발행된 세트는 복제하여 새 초안을 편집합니다.

## 검증 증거

`pnpm verify:full` 전체 통과:

- ESLint, Prisma/Next 타입 생성, TypeScript 검사.
- 단위 테스트 **8개**: 입력 정규화/채점과 CSV 검증.
- 실제 PostgreSQL 통합 테스트 **21개**: 소유권 격리, 동시 제출, 멱등성, 노출 기록, 공유 상태 집계, 콘텐츠 불변성, 런타임 역할 제한. DB 연결은 로컬 Supavisor transaction pooler를 사용하며 Storage 서명만 테스트 대역을 사용합니다.
- Next.js 프로덕션 빌드.
- 모바일 Chromium E2E **5개**: 관리자 발행→학습→기록, 실제 Auth/메일/Storage, 가입 확인/비밀번호 재설정, 권한 회수, CSRF, 잘못된 CSV·음원 거절, 응답 유실 후 재제출. 360px 화면의 가로 넘침 검사 및 주요 화면 이미지 확인.

추가 확인:

- 새 로컬 DB migration 적용과 `local:setup` 재실행 성공. 재실행 시 기존 런타임 DB 암호와 학습 기록을 유지합니다.
- `platform:setup`을 로컬 환경에서 실행하여 제한된 역할 및 private bucket 설정 확인.
- `pnpm audit --prod`: 알려진 취약점 없음.
- 브라우저 정적 산출물에서 서버 관리 키·DB 접속 URL·런타임 DB 암호가 발견되지 않음. `.env.local` 권한은 0600.
- 최종 로컬 설정 스크립트 수정 후 해당 파일 ESLint, 전체 TypeScript 검사, `local:setup` 재실행 통과.

GitHub Actions 워크플로는 작성했으며 원격 CI 실행은 이번 작업에서 하지 않았습니다.

## 의존성 패치

Prisma CLI/Client/adapter는 안정 버전 7.10.0을 유지합니다. 보안 감사 결과에 따라 `csv-parse`를 7.0.2로 고정하고, Prisma 하위 `mysql2`를 3.23.1, `@prisma/config` 하위 `deepmerge-ts`를 8.0.0으로 제한적으로 재정의했습니다. 변경 후 generate/migrate 및 전체 검증을 통과했습니다. Prisma 업데이트 시 재정의 필요성과 호환성을 다시 점검합니다.

근거: [CSV advisory](https://github.com/adaltas/node-csv/security/advisories/GHSA-8cw4-87c7-c6xx), [mysql2 release](https://github.com/sidorares/node-mysql2/releases/tag/v3.23.1), [deepmerge advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx). CLI의 전이 의존성 문제를 앱 경로에서 재현된 공격으로 해석하지 않습니다.

## 남은 범위와 검증 한계

- **당시 미구현 범위**: 날짜/요일/N일 일정, 자동 간격 반복, 복습 대기열(M4에서 구현), 장기 유지 평가, PWA·푸시·완전 오프라인(M5 이후).
- Vercel 및 hosted Supabase 배포, 실제 SMTP, 모바일 Safari/실물 기기의 음원·키보드 동작은 미검증입니다. [배포 절차](deployment.md)에 환경 변수·migration·운영 확인 항목을 정리했습니다.
- 현재 pg 8 계열/Prisma 실행에서 동일 client의 query 대기 관련 deprecation warning이 발생합니다. 테스트 실패는 없지만 pg 9로 올리기 전 호환성 확인이 필요합니다.
- 샘플 문장과 합성 음원은 시연용이며 상용 콘텐츠 검수를 대신하지 않습니다. 입력 회상 점수와 말하기 자기확인은 장기 암기 성공이나 발음 정확도의 증거가 아닙니다.
