# 개인 문장 최종 검증 핸드오프 (아직 미실행)

## 실행 경계

구현자는 테스트/빌드/린트/타입검사/앱/DB migration/브라우저를 실행하지 않았다. 부모가 전체 소스 작성 종료 후 한 번의 **최종 검증 캠페인**으로 준비·실행·결함 수정·재검증을 수행한다. 편집 도구가 자동 제공한 JSON 구문/LSP 알림은 실행 시험이나 PASS 증거로 사용하지 않는다.

원본 `/Users/jarvis/workspace/mem-lang-sen`은 수정하지 않았다. 전용 checkout은 `/Users/jarvis/workspace/mem-lang-sen-personal-sentences`, branch `feat/personal-sentences-import`, base `dad8eec0ac7055eb8a8a76ff2bd0520f60c6897c`다. 실제 .env/비밀/홈 credential은 읽지 않았다. 원격 push/PR/배포는 하지 않았다.

## 최종 격리 환경에서 실행할 명령 (지금 실행한 출력 아님)

```sh
pnpm install --frozen-lockfile
pnpm local:start
pnpm local:setup
pnpm exec playwright install chromium
pnpm verify:full
```

계정/DB는 기존 localhost guard를 유지한 disposable Supabase fixture여야 한다. host home/credential/.env/운영 URL/host Docker socket을 넘기지 않는다. Node24 필수. 실제 호스트에는 Node25가 있어 lockfile-only에서 engine 경고가 있었으나 앱/패키지 script를 실행하지 않았다.

추가 UI config는 그 config의 자체 서버 준비를 먼저 읽은 뒤 같은 최종 캠페인에서 실행한다:

```sh
pnpm exec playwright test --config=playwright.components.config.ts
pnpm exec playwright test --config=playwright.layout.config.ts
```

## 신규 작성 테스트

- `tests/unit/personal-sentences.test.ts`: schema/정규화/필수 질문/허용답안 최종 상한/서버 필드 주입/행 위치.
- `tests/unit/personal-import.test.ts`: TXT/실제 XLSX template/수식 캐시/외부 링크/매크로/병합/DTD/메타데이터 팽창/경로/손상/시트 선택/실제 스트림 한도/미지원 확장자.
- `tests/unit/personal-csrf.test.ts`: cookie+header 검증, 계정/인증 세션 바인딩, cross-site.
- `tests/integration/personal-content.test.ts`: 로컬 PostgreSQL, A/B/ADMIN, PUBLIC 격리, CHECK, CRUD/revision/불변 version, 세션·답안 replay·baseline·state 보존, assignment 분모/링크, 보관/복구/등록, 오늘 예산, 무음원 말하기, preview owner/TTL/revision/idempotency/동시성/오류 원자성/중복/한도.
- `tests/e2e/personal-sentences.spec.ts`: 360px 실제 UI로 다중 직접입력/서버 미리보기/저장후편집/기존학습/기록, TXT 질문 보완/재검증/보관복구, XLSX파일/행수정/자율연습, 관리자 격리와 CSRF.

모든 테스트는 **작성만** 했으며 PASS를 주장하지 않는다. 기존 공용·평가·auth·scheduling 테스트를 함께 실행해야 한다. 특히 migration fresh/기존 PUBLIC backfill 및 기존 이력 counts/FK, 서버리스 worker sax tracing, timeout 실제 종료, 다중 인스턴스 rate limit, 실제 모바일 파일 선택/오프라인 재전송은 실제 환경 출력과 구분해 기록한다.

## 구현 시 사용한 비실행 준비 작업

`pnpm install --lockfile-only --ignore-scripts`만 빈 HOME/허용 PATH와 npm registry로 실행했다. runtime 의존성 설치나 lifecycle은 실행하지 않았다. Python 표준 라이브러리로 정적 XLSX/TXT 다운로드 예제만 생성했으며 앱/파서/테스트를 호출하지 않았다.

## 운영상 명시 제약

미리보기 commit TTL30분과 raw normalizedRows 물리 정리는 다르다. 현재 후속 미리보기 생성 때 전역20건 bounded scrub, 7일 지난 멱등 메타데이터는 owner별20건 bounded delete다. 엄격한 시각 기반 파기 또는 다중 인스턴스 전역 rate limit은 운영 계층의 별도 승인 작업이 필요하다. 검증되지 않은 배포 준비/보안 인증을 주장하지 않는다.
