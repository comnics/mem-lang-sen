# Auth UUID와 이메일 수명주기

## 계정 정책

- Supabase `auth.getUser()`가 검증한 **UUID만** AppUser와 모든 학습 데이터의 소유권 키입니다. 이메일은 인증 수단을 대체하지 않는, 마지막 요청 시점의 프로필 스냅샷입니다.
- AppUser.email은 중복 가능합니다. A가 이메일을 변경한 뒤 앱에 다시 오지 않거나 Auth 계정을 삭제해도 오래된 AppUser 이메일이 B의 생성을 막지 않습니다. 이메일 없는 Auth 사용자도 UUID별로 분리됩니다.
- 요청 시 UUID upsert로 이메일을 동기화합니다. 생성 시 role=USER, status=ACTIVE, onboarded=false의 DB 기본값을 사용하며 사용자 metadata에서 권한을 읽지 않습니다. 기존 UUID의 role/status/표시 이름/onboarding/관계 데이터는 수정하지 않습니다.
- Auth 삭제 후 같은 이메일로 가입하면 **새 UUID의 새 계정**입니다. 이전 UUID의 관리자 권한·정지 상태·학습 데이터·푸시 구독을 이전하지 않습니다. 기존 앱 레코드는 보존되며 이 변경은 삭제/자동 복구 기능이 아닙니다. 이전 데이터 접근이 필요하면 별도의 본인확인 및 운영 정책이 필요합니다. 이메일 일치만으로 자동 복구하지 않습니다.
- 이메일 변경은 해당 UUID가 다음에 검증된 요청을 보낼 때 반영됩니다. webhook을 통한 즉시 동기화나 동시 Auth 변경의 순서 보장은 범위 밖입니다. AppUser.email을 권한 검사·계정 검색 키로 사용하지 않습니다. 관리자 부여 도구 역시 검증된 UUID만 사용합니다.

## 배포 / 호환성 / 롤백

1. `20261111000000_auth_email_snapshot` migration을 **앱 코드 배포 전** 적용합니다. 기존 email UNIQUE index만 삭제하며 UUID/FK/기존 데이터는 바꾸지 않습니다. DDL은 잠금이 필요하므로 유지보수 절차와 백업 아래 적용하세요. 운영 DB에는 이 작업에서 적용하지 않습니다.
2. 새 Prisma client와 앱 코드를 함께 배포합니다. 구버전 서버가 남아 있으면 신규 UUID 중복 이메일은 더 이상 막히지 않지만 기존 이메일 스냅샷 갱신은 새 버전에만 적용됩니다.
3. 롤백 시 앱 코드만 되돌려도 중복 이메일 행이 있으면 구 스키마 UNIQUE를 바로 복원할 수 없습니다. 먼저 읽기 전용으로 중복을 확인하고 운영 판단을 받으세요. 기존 UUID/학습 데이터를 삭제하거나 이메일 기준 병합하여 UNIQUE를 복원하지 마세요. 이메일 동기화 롤백은 스냅샷 노후화를 다시 일으킬 수 있습니다.

## 회귀 / 검증 경계

- `tests/unit/auth.test.ts`: 실제 getCurrentUser/requireUser/requireAdmin, Auth/DB 경계 대역. A 미재방문·이메일 변경·삭제 후 새 UUID·동시 최초 요청·기존 권한/정지/프로필 보존·이메일 없음·인증 실패·DB 실패. 메모리 대역은 PostgreSQL 충돌/동시성 증거가 아닙니다.
- `tests/integration/auth.test.ts`: 실제 PostgreSQL index, 동일 이메일 다른 UUID, 이메일 변경 시 보존, 12개 병렬 UUID upsert, 이전 UUID의 StudyPlan 소유권 보존. Auth 응답만 대역입니다. 격리 로컬 DB와 migration 적용이 필요합니다.
- `tests/e2e/auth-lifecycle.spec.ts`: 실제 로컬 Supabase Admin으로 이메일 변경/삭제/재가입 후 실제 로그인 API·보호 페이지·관리자 API 거부·PostgreSQL 소유권 보존을 확인합니다. A가 재방문하지 않은 stale email 경로도 포함합니다. app/Auth/DB가 모두 loopback인 경우만 허용하며 생성한 UUID만 정리합니다.
- 실제 PostgreSQL 및 Auth E2E 실행 결과는 PR에 별도 기록합니다. 환경 부재로 미실행이면 위 테스트 추가만으로 완료 기준을 검증했다고 주장하지 않습니다.
