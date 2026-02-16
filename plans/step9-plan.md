# Step 9 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-16
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`, `plans/step8-plan.md`
> 본 계획의 구현 순서 기준은 `Phase 2 Step 9`를 따른다.

---

### Step 9: 관리자 워크스페이스 (Step 5 이후 신규)

> Step 5 완료 이후에만 진행한다.
> 완료된 Step 1~5의 핵심 계약(공개 라우트/AI API)은 유지하고, `/write`는 하위 호환 리다이렉트로 `/admin/write` 전환한다.

#### 구현 항목

- **관리자 인증 도입 (옵션 D: 비밀번호 + TOTP 2FA 적용)**
  - `/admin/login` 페이지 + `POST /api/admin/auth/login`(1차) + `POST /api/admin/auth/verify`(2차) 구현
  - 2차 인증 성공 시 세션 쿠키(`HttpOnly`, `Secure`, `SameSite=Lax`) 발급
  - 복구코드 1회성 사용/폐기 정책 적용
  - 상태 변경 API는 CSRF 토큰(`Signed Double-Submit Cookie`, 세션 바인딩 HMAC) 검증 적용
  - `SameSite=Lax`는 보조 완화 수단으로 사용하고, 상태 변경 요청은 CSRF 토큰 검증을 필수 적용
  - `/admin/write`, `/admin/notes`, `/admin/todos`, `/admin/schedules` 접근 제어
  - 기존 `/write`는 `/admin/write`로 리다이렉트 (하위 호환)
- **관리자 스키마/마이그레이션 추가**
  - `admin_auth`, `admin_sessions`, `admin_recovery_codes` 생성
  - `admin_notes`, `admin_todos`, `admin_schedules` 생성
- **관리자 글쓰기 전환**
  - 브라우저 localStorage의 API Key 의존 제거
  - admin 2FA 세션 기반으로 글 작성/수정 API 호출 (`/api/admin/posts/*`)
- **메모 관리 기능**
  - 단건/목록 조회, 생성, 수정, 삭제 (CRUD)
  - 제목 + 본문 + 핀(Pin) + 업데이트 시각 정렬
- **일정/TODO 관리 기능**
  - TODO: 상태(`todo`, `doing`, `done`), 우선순위, 마감일
  - 일정: 날짜/시간 범위, 메모, 완료 여부
  - 캘린더/리스트 혼합 UI (모바일 우선 반응형)

#### 구현 범위/파일 경계

- 신규 페이지 라우트
  - `src/app/admin/login/page.tsx`
  - `src/app/admin/write/page.tsx`
  - `src/app/admin/notes/page.tsx`
  - `src/app/admin/todos/page.tsx`
  - `src/app/admin/schedules/page.tsx`
- 신규 API 라우트
  - `src/app/api/admin/auth/login/route.ts`
  - `src/app/api/admin/auth/verify/route.ts`
  - `src/app/api/admin/auth/logout/route.ts`
  - `src/app/api/admin/posts/route.ts`
  - `src/app/api/admin/posts/[id]/route.ts`
  - `src/app/api/admin/notes/route.ts`, `src/app/api/admin/notes/[id]/route.ts`
  - `src/app/api/admin/todos/route.ts`, `src/app/api/admin/todos/[id]/route.ts`
  - `src/app/api/admin/schedules/route.ts`, `src/app/api/admin/schedules/[id]/route.ts`
- 인증/보안 유틸
  - `src/lib/admin-auth.ts` (비밀번호 검증, 세션/쿠키 처리)
  - `src/lib/admin-csrf.ts` (Signed Double-Submit Cookie 검증)
  - `src/lib/admin-totp.ts` (TOTP/복구코드 검증)
- 업로드 인증 경계
  - `/api/admin/uploads`를 신규 추가하고 관리자 UI는 해당 경로만 사용한다.
  - 기존 `/api/uploads`는 AI API Key 전용 경로로 유지한다.
- 기존 라우트/호환 처리
  - `src/app/write/page.tsx`는 `/admin/write` 리다이렉트 전용으로 축소
  - `/write?id={id}` 요청은 `/admin/write?id={id}`로 쿼리 보존 리다이렉트
  - 네비게이션 링크를 `/write`에서 `/admin/write`로 교체 (`src/app/layout.tsx` 포함)

#### DB 마이그레이션 전략

- Step 9에서 `schema_version`을 상향(예: `v2`)한다.
- `src/lib/db.ts`의 마이그레이션 루틴에 Step 9 전용 SQL 블록을 추가한다.
- `admin_auth`, `admin_sessions`, `admin_recovery_codes`, `admin_notes`, `admin_todos`, `admin_schedules`를 `IF NOT EXISTS`로 생성한다.
- admin 관련 조회/만료 정리를 위한 인덱스를 함께 추가한다.
- `admin_auth.totp_secret_encrypted`는 `ADMIN_TOTP_SECRET_ENCRYPTION_KEY`로 암호화된 값으로 저장한다.
- 기존 데이터와 공존 가능한 멱등 마이그레이션(재실행 안전) 원칙을 유지한다.

#### 환경변수/비밀값

- 필수(운영)
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD_HASH`
  - `ADMIN_SESSION_SECRET`
  - `ADMIN_TOTP_SECRET_ENCRYPTION_KEY` (TOTP secret 저장/복호화 키)
  - `ADMIN_CSRF_SECRET`
- 선택(운영 정책)
  - `ADMIN_SESSION_MAX_AGE_SECONDS`
  - `ADMIN_LOGIN_RATE_LIMIT_MAX`, `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS`
  - `ADMIN_VERIFY_RATE_LIMIT_MAX`, `ADMIN_VERIFY_RATE_LIMIT_WINDOW_MS`
- 비밀번호 해시 알고리즘은 `Argon2id`로 고정한다.

#### 의존성/빌드 영향

- 비밀번호 해시 구현은 `@node-rs/argon2` 패키지를 사용해 Argon2id를 적용한다.
- native 패키지 도입에 따라 standalone 빌드 시 `next.config.ts`의 `serverExternalPackages`에 해당 패키지 포함 여부를 검토/반영한다.
- Step 9 구현 완료 검증에 `npm run build`(standalone 포함) 성공을 필수로 포함한다.

#### 영향 파일/회귀 영향

- 기존 코드 영향
  - `src/app/layout.tsx` (글쓰기 메뉴 링크 전환)
  - `src/app/write/page.tsx` (리다이렉트 처리)
  - 기존 API Key 기반 글쓰기 API(`src/app/api/posts/*`)는 AI 전용으로 유지
- 테스트 영향
  - `tests/ui/visual-regression.spec.ts` 라우트 갱신(`write` → `admin-write`)
  - `tests/ui/write-e2e.spec.ts`를 admin 인증 기반 시나리오로 대체/분리
  - `tests/ui/accessibility.spec.ts` 대상 경로 갱신
  - `tests/ui/helpers.ts`의 인증 헬퍼를 admin 세션 기준으로 확장
- 실행 스크립트 영향
  - `package.json`에 `test:step9` 추가
  - `scripts/test-all.mjs`에 `test:step9` 편입

#### 인증 시도 제한(브루트포스 방어)

- `/api/admin/auth/login`과 `/api/admin/auth/verify`는 레이트 리밋을 별도로 적용한다.
- 기존 `src/lib/rate-limit.ts`를 재사용하되, 라우트별 키 prefix를 분리한다.
- 한도 초과 시 `429` + `retryAfterMs`를 반환한다.

#### 비범위(Out of Scope)

- 다중 관리자 계정/권한(Role) 모델 도입
- OAuth(Auth.js) 기반 로그인 전환
- 기존 AI API 계약(`src/app/api/posts/*`, `BLOG_API_KEY` 인증) 변경
- Step 10/11 항목(검색/RSS/통계/메일링 등) 선반영

#### 권장 구현 순서

1. DB 마이그레이션(`schema_version v2`) 및 admin 테이블/인덱스 반영
2. 인증 유틸 구현(`admin-auth`, `admin-totp`, `admin-csrf`) + 로그인/검증/로그아웃 API
3. admin CRUD API 구현(`posts`, `notes`, `todos`, `schedules`)
4. admin 페이지(`/admin/login`, `/admin/write`, `/admin/notes`, `/admin/todos`, `/admin/schedules`) 구현
5. `/write` 리다이렉트 및 네비게이션 링크 전환
6. `test:step9` 작성/검증 후 `test:all` 편입 및 회귀 통과

#### 운영 리스크 대응 메모

- TOTP는 서버 시간 오차에 민감하므로 운영 서버 NTP 동기화 상태를 배포 체크리스트에 포함한다.
- `ADMIN_SESSION_SECRET`/`ADMIN_CSRF_SECRET` 교체 시 기존 세션 무효화 정책을 운영 문서에 명시한다.
- 로그인/2차 인증 실패 누적은 구조화 로그로 모니터링하고, 임계치 초과 시 알림 기준을 별도 정의한다.

#### 예정 테스트

1. **관리자 로그인 1차 성공 → 2차 인증 챌린지 발급**
   ```bash
   curl -i -c /tmp/admin-cookie.txt -X POST http://localhost:3000/api/admin/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}'
   ```
   - 기대 결과: HTTP `200`, `requiresTwoFactor=true` 응답

2. **잘못된 TOTP 코드 → 401**
   ```bash
   curl -i -c /tmp/admin-cookie.txt -X POST http://localhost:3000/api/admin/auth/verify \
     -H "Content-Type: application/json" \
     -d '{"code":"000000"}'
   ```
   - 기대 결과: HTTP `401`

3. **정상 TOTP 코드 → 세션 쿠키 발급**
   ```bash
   curl -i -c /tmp/admin-cookie.txt -X POST http://localhost:3000/api/admin/auth/verify \
     -H "Content-Type: application/json" \
     -d '{"code":"<TOTP_CODE>"}'
   ```
   - 기대 결과: HTTP `200`, `Set-Cookie`에 `HttpOnly` 포함

4. **동일 TOTP 코드 재사용 시 거부**
   ```bash
   # 직전 성공에 사용한 동일 코드로 즉시 재검증
   ```
   - 기대 결과: HTTP `401` (재사용 코드 거부)

5. **세션 없이 관리자 API 접근 → 401**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/notes
   ```
   - 기대 결과: HTTP `401`

6. **메모 CRUD**
   ```bash
   curl -s -b /tmp/admin-cookie.txt -X POST http://localhost:3000/api/admin/notes \
     -H "Content-Type: application/json" \
     -d '{"title":"운영 메모","content":"주간 점검 항목","isPinned":true}'

   curl -s -b /tmp/admin-cookie.txt http://localhost:3000/api/admin/notes | grep -c "운영 메모"
   ```
   - 기대 결과: 생성 `201`, 목록 조회 시 grep 결과 `1` 이상

7. **TODO 상태 전이 (`todo -> doing -> done`)**
   ```bash
   # 생성 후 PATCH 2회로 상태 전환 검증
   ```
   - 기대 결과: 상태 전이가 순서대로 반영되고 최종 상태가 `done`

8. **일정 CRUD + 날짜 범위 조회**
   ```bash
   # 일정 생성(시작/종료 시각 포함) 후 특정 주간 범위 조회
   ```
   - 기대 결과: 생성 `201`, 범위 조회에서 포함됨

9. **관리자 상태 변경 요청 CSRF 검증**
   ```bash
   # CSRF 헤더/쿠키 없이 POST/PATCH 요청
   ```
   - 기대 결과: HTTP `403` 또는 `401` (정의한 에러 규약에 맞는 CSRF 거부 응답)

10. **관리자 UI Playwright 회귀 (360/768/1440)**
   ```bash
   npm run test:ui -- tests/ui/admin-workspace.spec.ts
   ```
   - 기대 결과:
     - `/admin/login`, `/admin/write`, `/admin/notes`, `/admin/todos`, `/admin/schedules` 스크린샷 회귀 통과
     - 기능 assertion(로그인/CRUD 핵심 동작) 통과
     - 접근성 검사(`@axe-core/playwright`)에서 serious/critical 위반 없음

11. **관리자 실서비스형 E2E 흐름 (로그인 → 작성 → 공개 페이지 확인)**
   ```bash
   npm run test:ui -- tests/ui/admin-write-e2e.spec.ts
   ```
   - 기대 결과:
     - `/admin/login`에서 1차/2차 인증 성공 후 `/admin/write` 접근 가능
     - 글 게시 후 `/posts/{slug}`로 이동하고 본문/태그가 노출됨

12. **`/write` 하위 호환 리다이렉트 검증 (`?id` 보존 포함)**
   ```bash
   npm run test:ui -- tests/ui/admin-write-redirect.spec.ts
   ```
   - 기대 결과:
     - `/write` 접근 시 `/admin/write`로 리다이렉트
     - `/write?id=123` 접근 시 `/admin/write?id=123`로 리다이렉트

13. **세션 만료/로그아웃 이후 접근 차단**
   ```bash
   # 만료 세션 또는 로그아웃 직후 상태 변경 요청
   ```
   - 기대 결과: HTTP `401` (재인증 요구)

14. **복구코드 1회성 사용 검증**
   ```bash
   # 복구코드로 1회 인증 성공 후 동일 코드 재사용 시도
   ```
   - 기대 결과: 1회 성공 후 동일 복구코드는 HTTP `401`로 거부

15. **업로드 인증 경계 검증 (`/api/admin/uploads` 단일 사용)**
   ```bash
   # admin 세션으로 /api/uploads 호출
   # admin 세션으로 /api/admin/uploads 호출
   ```
   - 기대 결과:
     - `/api/uploads`는 admin 세션만으로는 허용되지 않음(401/403)
     - `/api/admin/uploads`는 admin 세션으로 업로드 성공

#### 회귀 실행 게이트

- Step 9 전용 자동화 스크립트(`scripts/test-step-9.mjs`)를 추가한다.
- `package.json`에 `test:step9` 스크립트를 등록한다.
- `scripts/test-step-9.mjs` 검증 범위:
  - admin 1차/2차 인증 성공/실패
  - 세션 없는 접근 차단
  - 복구코드 1회성 사용
  - notes/todos/schedules CRUD 핵심 시나리오
  - CSRF 거부 시나리오
  - 업로드 인증 경계(`admin`은 `/api/admin/uploads`, AI는 `/api/uploads`) 검증
- Step 9 기능 변경 완료 후 `npm run test:step9`을 실행한다.
- Step 9 구현 완료 시 `test:all`에 `test:step9`을 편입하고 문서/스크립트를 같은 커밋에서 동기화한다.
- `npm run test:all` 통과 후에만 PR 생성/병합/다음 Step 진행을 수행한다.
- `test:step9`는 독립 DB(`DATABASE_PATH=data/test-step9.db`)를 사용해 실행한다.
- `test:step9` 통과 기준:
  - 관리자 인증/세션/CSRF/복구코드/CRUD 시나리오 전부 통과
  - 실패 시 API 응답/서버 로그를 출력하고, UI 실패 시 Playwright 아티팩트를 보관

#### Definition of Done

- 코드
  - `/admin/*` 페이지와 `/api/admin/*` API가 명세대로 동작한다.
  - admin 인증/세션/CSRF/복구코드 정책이 구현되고, `/write`는 `/admin/write`로 하위 호환 리다이렉트된다.
  - admin 스키마 마이그레이션(`v2`)이 멱등적으로 적용된다.
- 테스트
  - `npm run test:step9` 통과
  - `npm run test:all` 통과(`test:step9` 편입 상태)
  - Playwright 관리자 UI 검증(스크린샷 360/768/1440 + 기능 assertion + 접근성 검사) 통과
- 문서
  - `plans/implementation-plan.md` Step 9 상태/결과 동기화
  - `docs/codebase.md`의 인증/라우트/테스트 구조를 admin 전환 기준으로 갱신
