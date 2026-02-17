# ISSUE #59 fix: 관리자 2FA 재등록 허용 취약점 수정

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/59
- Issue 번호: 59
- 기준 브랜치: main (origin/main)
- 작업 브랜치: issue-59-fix-admin-2fa-rebind
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-59-fix-admin-2fa-rebind
- 작성일: 2026-02-17

## 배경/문제
현재 관리자 로그인은 1차(아이디/비밀번호) 인증을 통과하면 `admin_login_challenge` 쿠키가 발급되고, 이 쿠키만 있으면 `GET /api/admin/auth/totp-setup`에서 TOTP secret/QR을 조회할 수 있다.

따라서 아이디/비밀번호만 탈취되어도 공격자가 secret을 획득해 자신의 Authenticator에 등록한 뒤, `POST /api/admin/auth/verify`로 2차 인증을 통과하여 관리자 세션을 발급받을 수 있다. (2FA가 "활성화"되어 있어도 재등록이 가능해 2FA 효과가 약화됨)

## 목표
- [ ] 2FA가 활성화된 상태에서는 password-only 단계에서 TOTP secret/QR을 재조회할 수 없다.
- [ ] 관리자 세션은 2차 인증(TOTP 또는 recovery code) 통과 이후에만 발급된다(회귀 방지).
- [ ] (선택) 2FA 재등록/초기화는 명시적 플로우(기존 TOTP 또는 recovery code 재검증)에서만 가능하다. (미구현 시 후속 이슈로 분리)
- [ ] Playwright로 재현/회귀 테스트를 추가한다.

## 범위
### 포함
- 2FA 활성화 상태 모델 추가(`admin_auth.totp_enabled_at` 등)
- `/api/admin/auth/totp-setup` 접근 정책 변경(활성화 후 차단)
- `/api/admin/auth/verify`에서 TOTP로 2차 인증 성공 시 2FA 활성화 마킹(최초 1회)
- 로그인 UI에서 활성화 상태에 따라 "QR 보기" 노출/동작 제어
- 테스트(Playwright) + 필요한 경우 단위 테스트

### 제외
- 다중 관리자/다중 계정 지원
- TOTP secret 자동 로테이션(운영 env 갱신 포함)
- 다른 MFA 방식(WebAuthn 등) 도입
- (이번 이슈에서는 미구현) 2FA 재등록/초기화 UI/플로우(`/admin/security` 등) — 후속 이슈로 분리

## 결정 필요(옵션)
### A. 활성화 플래그 기반(권장)
- `admin_auth.totp_enabled_at`(NULL/NOT NULL)로 "2FA 활성화"를 표현
- 활성화 전: 로그인 단계에서 `totp-setup` 허용(bootstrap)
- 활성화 후: 로그인 단계 `totp-setup` 차단, 재등록은 별도 리셋 플로우에서만 허용

### B. 로그인 단계에서 `totp-setup` 완전 제거
- 장점: password-only 단계에서 secret 노출이 원천 차단
- 단점: 최초 설정/기기 변경 UX가 악화(운영자 수동 설정 필요)

**결정(권장)**: 옵션 A로 진행한다.

## 구현 단계
1. [ ] 현황 파악
- 현재 secret 노출 경로 확인
  - UI: `src/app/admin/login/AdminLoginClient.tsx`의 "Authenticator 등록 QR 보기"
  - API: `src/app/api/admin/auth/totp-setup/route.ts`
  - 설정/검증: `src/lib/admin-auth.ts`, `src/lib/admin-totp.ts`
- DB 스키마/마이그레이션 방식 확인: `src/lib/db.ts` (`schema_versions`)

2. [ ] DB: 2FA 활성화 상태 추가
- 마이그레이션(version 4): `admin_auth`에 `totp_enabled_at TEXT` 컬럼 추가(초기 NULL)
- 기존 운영 DB(이미 `admin_auth` row가 존재하는 경우)는 마이그레이션에서 `totp_enabled_at`을 `datetime('now')`로 초기화해 배포 직후 윈도우를 제거
- 읽기 모델: `AdminAuthRow`/쿼리에서 컬럼 포함

3. [ ] API 정책 변경
- 에러 응답은 공통 포맷 `{ error: { code, message, details } }`를 따른다.
- `GET /api/admin/auth/totp-setup`
  - 로그인 challenge(`admin_login_challenge`)가 유효하지 않으면 기존처럼 401
  - `totp_enabled_at IS NOT NULL`이면 `409` + `error.code="TOTP_ALREADY_ENABLED"`로 차단(메시지: "TOTP is already enabled.")
  - `totp_enabled_at IS NULL`이면 기존처럼 setup info + QR 반환
- `POST /api/admin/auth/verify`
  - 2차 인증 성공 시(TOTP로 통과한 경우) `totp_enabled_at`이 NULL이면 `datetime('now')`로 설정(1회)
  - 성공 응답/세션 발급 로직은 유지(세션은 verify에서만 발급)

4. [ ] UI 변경(로그인)
- 로그인(1차) 응답에 `totpEnabled`(또는 `totpSetupAvailable`)를 포함하도록 `/api/admin/auth/login` 개선(권장)
  - 활성화 상태면 "QR 보기" 영역 숨김 또는 안내문으로 대체
  - 비활성화 상태(bootstrap)일 때만 QR/secret 노출
- (보완) API가 `409(TOTP_ALREADY_ENABLED)`를 반환할 때 UX: "이미 2FA가 활성화되어 있습니다" 메시지 출력

5. [ ] (후속 이슈) 재등록/초기화 플로우(명시적)
- `/admin/security`(또는 유사 페이지)에서 "새 기기 등록" 제공
- 조건: 관리자 세션 + TOTP/복구코드 재검증(POST) 후에만 secret/QR 재노출
- secret 로테이션은 이번 이슈 범위에서 제외(필요 시 별도 이슈)

6. [ ] 테스트(Playwright)
- 신규 스펙 예: `tests/ui/admin-2fa-setup-lock.spec.ts`
  - 시나리오: 정상 로그인(2FA 통과) → 로그아웃 → 재로그인(1차) → verify 단계에서 QR/secret 재조회가 차단되는지 확인
  - (선택) API 레벨: `GET /api/admin/auth/totp-setup`이 `409(TOTP_ALREADY_ENABLED)` 반환
  - 단언(보안 핵심)
    - 1차 인증 직후: `admin_login_challenge`는 존재하고 `admin_session`은 존재하지 않는다(세션 발급 회귀 방지)
    - 2차(TOTP) 성공 직후: `admin_session`이 존재한다
    - 활성화 후 재로그인(1차) 상태: `GET /api/admin/auth/totp-setup`이 `409(TOTP_ALREADY_ENABLED)`를 반환한다(서버 차단)
    - 활성화 후 UI: "Authenticator 등록 QR 보기" 버튼이 숨김/비활성 처리된다(UX 회귀 방지)
  - 스크린샷 회귀: 최소 뷰포트 `360/768/1440`에서 `toHaveScreenshot` 포함
  - 접근성: `@axe-core/playwright`로 serious/critical 위반 0
  - 안정화: 애니메이션 비활성화, 고정 시드 데이터, 고정 타임존/로케일(기존 설정 준수)
- 회귀: `npm run test:ui`, `npm run test:all`

## 리스크 및 확인 필요 사항
- 신규 설치/초기 설정에서 `totp_enabled_at` 초기값 처리:
  - `totp_enabled_at`이 NULL인 동안은 bootstrap 단계로 간주되어 password-only 단계에서 QR/secret 조회가 가능함(최초 등록 목적)
  - 기존 운영 DB는 마이그레이션에서 `totp_enabled_at=datetime('now')`로 초기화해 배포 직후 윈도우를 제거(이미 2FA를 사용 중이라는 가정)
  - 운영에서 아직 Authenticator 등록 전인데 `totp_enabled_at`이 세팅되어 QR이 차단되면, 1회성으로 `admin_auth.totp_enabled_at`을 NULL로 되돌린 뒤 최초 등록을 진행(또는 Step 5 플로우를 구현)
- `ensureAdminConfigSynced()`가 `admin_auth`를 upsert하므로, 새 컬럼이 의도치 않게 초기화되지 않도록 주의
- HTTP 상태코드(`409(TOTP_ALREADY_ENABLED)`) 및 에러 메시지 합의 필요(UI/테스트에 영향)

## 영향 파일(예상)
- `src/lib/db.ts` (schema version 4 migration)
- `src/lib/admin-auth.ts`
- `src/app/api/admin/auth/login/route.ts`
- `src/app/api/admin/auth/verify/route.ts`
- `src/app/api/admin/auth/totp-setup/route.ts`
- `src/app/admin/login/AdminLoginClient.tsx`
- `tests/ui/*` (신규 스펙)

## 완료 기준(DoD)
- [ ] 2FA 활성화 이후: 재로그인(비번만 통과) 상태에서 TOTP secret/QR이 노출되지 않는다.
- [ ] 관리자 세션은 `POST /api/admin/auth/verify` 성공 후에만 발급된다.
- [ ] Playwright 테스트로 위 시나리오가 고정된다.
- [ ] `npm run test:all` 통과

## 검증 계획
- [ ] `npm run test:ui`
- [ ] `npm run test:all`
