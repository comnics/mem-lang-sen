# 개인 문장 기능 최종 검증 보고

- 코드 검증 커밋: `07dcf3d7742a2279e7eb3125f94e7a8407e3b122`
- 기준 main: `dad8eec0ac7055eb8a8a76ff2bd0520f60c6897c`
- 구현 중에는 테스트를 실행하지 않았고, 전체 구현 후 하나의 최종 검증 캠페인에서 결함 수정·재검증을 진행했다.
- 이 문서 추가는 문서 변경뿐이며 아래 검증 수치는 위 코드 커밋에 대한 것이다.

## 구현 범위
비공개 개인 세트, 직접 다중 입력, XLSX/UTF-8 TXT 업로드, 미리보기 행 편집·재검증·원자 저장, 저장 문장 새 버전 편집, 보관/복구, 등록·자율 연습·오늘/복습 연결, 사용자별 접근 제어·CSRF·파일 자원 제한, 다운로드 템플릿.

## 실행 환경
운영 자격증명 없는 macOS deny-default sandbox, Node24.22.3 / pnpm10.3.0 / PostgreSQL17 / Chromium. 데이터는 폐기 가능한 로컬 fixture다. 앱·브라우저·DB는 실제 실행했지만 production UI의 Auth HTTP는 명시적인 synthetic fixture다. 실제 Supabase Auth/메일/Storage 통과로 해석하면 안 된다.

## 검증 결과
- lint: PASS.
- typecheck: PASS.
- 전체 단위: **244 PASS**.
- production build: PASS.
- 전체 DB integration: **111 PASS / 5 SKIP**, Storage suite의 beforeAll 실패로 **전체 명령 exit1**. Storage 서비스 부재(로컬 연결 거부) 때문에 5개 테스트 본문 미실행. 전체 통합 GREEN 아님.
- 신규 개인 DB integration: 위 111개 중 **19 PASS**.
- production 개인 UI: **3 PASS**. 직접2행 입력→편집→입력 회상→기록, TXT2행→누락 질문 보완→저장→보관/복구, XLSX 실제 업로드→행 편집→2문장 저장→말하기 연습 화면. XLSX 말하기 전체 제출 완료까지의 증거는 아님.
- component/layout: 각각 **10 PASS**인 직전 수정본 증거 재사용. 해당 UI·테스트 파일은 최종 수정에서 동일하며, 최종 커밋의 신규 실행 20개로 합산하지 않는다.
- 전체 원본 E2E16개 중 최종 커밋 개인 기능3개 실행, 나머지 **13개 미실행**.
- fresh migration7개 및 기존 PUBLIC/history backfill·FK 보존: 스키마 동일한 초기 구현본에서 실제 DB 검증 PASS, 이후 migration 변경 없음. 최종 재실행에서 migration7개 완료 상태 확인.

## 발견·수정한 결함
1. 오늘 큐 숨김 preference가 명시적 PRACTICE까지 만료시킨 회귀: 자동 DAILY/ASSESSMENT에만 적용, owner/보관/개인 등록 보호 유지.
2. JSX try/catch lint·공용 상태 DTO 타입·fixture 계약 오류: 수정 후 lint/type/unit/build 통과.
3. Zod4 생성 default가 PATCH의 미전달 metadata를 덮어쓴 문제: 생성/PATCH 분리, 실제 DB 보관·복구·제목 변경의 metadata 보존 회귀 PASS.
4. Turbopack이 worker용 sax 경로를 숫자 module-ID로 만든 문제: 런타임 resolve·절대경로 검증 유지, production XLSX UI PASS 및 preview route NFT의 실제 sax 파일 추적 확인.

## 수용 판정 및 잔여 게이트
독립 사양·품질 재리뷰에서 알려진 코드 차단 결함은 해소됐다. 로컬 기능 수용 및 **Draft PR** 제출까지 완료 대상으로 삼는다. 실제 Auth/메일/Storage, 미실행 전체 E2E, 실제 모바일 파일선택·오프라인 전환, serverless 배포 worker 환경 검증은 남아 있다. preview TTL과 물리 삭제 시각의 차이, 다중 인스턴스 rate limit은 운영 문서의 제한을 따른다.

`verify:full` GREEN·운영 배포 준비 완료·병합 승인으로 표시하지 않는다. 자동 병합과 운영 배포는 수행하지 않는다.

## 사용 경로
기존 **내 문장 → 직접 만든 문장 → 개인 세트 만들기**. 직접 입력 또는 XLSX/TXT 가져오기 후 편집·저장하고, **내 세트로 등록** 후 입력 회상/말하기 자기확인 또는 오늘 학습에서 학습한다. 지원 형식·헤더·한도·보관/수정 시 이력 정책은 `docs/personal-sentences.md`, 설계·WBS는 `docs/plans/personal-sentences-design-wbs.ko.md` 참조.
