# M4 구현·검증 결과

검증일: 2026-10-14. 로컬 구현 결과이며 Vercel·hosted Supabase 배포는 수행하지 않았습니다.

## 구현

| 영역 | 결과 | 주요 파일 |
|---|---|---|
| 복습 정책 | 1/3/7/14/30일 상대 간격, 지연 무도움 입력 검증, 오답·도움 후 답 재학습, 어려움 유지, 말하기 자기확인 분리 | `src/domain/review.ts`, `src/server/services/learning.ts` |
| 일정 | 요일/N일 주기, 시작·목표일, 시간대·시각, 날짜 추가/휴식 예외, DST 처리 | `src/domain/scheduling.ts`, `src/domain/study-plan.ts`, `src/features/learner/OnboardingForm.tsx` |
| 오늘 학습 | 서버 문항 선택, 복습 우선·시간 예산, 공유 문장 중복 제거, 동시 시작 재사용, 14일 미리보기 | `src/server/services/scheduling.ts`, `src/app/api/v1/today/route.ts`, `src/features/learner/TodayQueueClient.tsx` |
| 부담 조절 | 전체/세트 정지, 부채 이월, 7일 부재 후 복귀일 최대 3분 | `src/server/services/scheduling.ts`, `src/features/learner/EnrollmentControls.tsx` |
| 기록·보호 | 원래 기한/배정 시각/실제 제출 시각 분리, 과거 기록 보존, 동일 제출 재전송, 만료·비공개 문항 차단 | `prisma/schema.prisma`, `src/server/services/daily-session.ts`, `src/server/services/learning.ts` |

상세 규칙과 API는 [M4 복습·일정 동작](m4-review-scheduling.md)에 정리했습니다. 기존 M0–M3 기능을 유지하며 별도 의존성 추가 없이 구현했습니다.

## 검증

`pnpm verify:full` 통과:

- ESLint, Prisma/Next 타입 생성, TypeScript 검사.
- 단위 테스트 **31개**: 채점·CSV와 순수 복습, 요일/N일, 날짜 예외, DST, 입력 검증.
- 로컬 PostgreSQL 통합 테스트 **43개**: 기존 21개 + M4 22개. 기한·노출·중복 제출·동시 탭·공유 문장·예산·복귀·시간대 변경·만료 세션·발행 해제 검증. 실제 DB와 transaction pooler를 사용하며 Storage 서명만 테스트 대역을 사용합니다.
- Next.js 프로덕션 빌드.
- 360px 모바일 Chromium E2E **6개**: 기존 5개 + 일정 설정→날짜 예외→자동 배정→어려움 제출→이어가기→전체 정지 흐름.

기존 로컬 DB에 M4 migration을 적용했고, 별도의 임시 빈 DB에서도 두 migration의 순차 적용을 확인했습니다. 임시 DB는 검증 후 제거했습니다. 코드 리뷰에서 지적된 만료 세션·보관된 콘텐츠·빈 대기열 안내 문제를 수정하고 회귀 테스트를 추가했습니다. 재검토 결과 해당 범위의 남은 문제는 없었습니다.

모바일 화면을 직접 확인해 날짜 예외 입력란을 두 줄로 배치하고 복습 사유를 한국어로 표시했습니다. 화면 수정 후 lint·빌드·관련 모바일 E2E를 다시 확인했습니다.

## 다음 단계와 한계

- **M5**: 주간 누적·응용 테스트, 7/30일 유지 평가, 전체 달력·상태·메모·신고·관리자 품질 지표.
- **M6 이후**: PWA, 푸시, Cron, 오프라인 제출 흐름.
- 실제 호스팅 배포, SMTP, 모바일 Safari·실물 기기 검증은 별도입니다.
- 기존 pg 8/Prisma의 중첩 query deprecation warning은 남아 있으며 테스트 실패는 없습니다. pg 9 업데이트 전 호환성 점검이 필요합니다.
- 복습 정책은 초기 규칙이며, 현재 성공 횟수로 장기 암기 완료나 발음 정확도를 판정하지 않습니다.
