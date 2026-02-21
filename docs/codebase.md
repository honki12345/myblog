# Honki Codebase Documentation Pack

## 0. Sync Anchor (main)

- 목적: 문서/코드 동기화 시 기준이 되는 `main` 브랜치 최신 반영 커밋을 명시한다.
- 기준 브랜치: `main`
- 최신 동기화 커밋: `69f25a3d4b547fbdcf31a09f73ac6792ee18b3e1` (`69f25a3`)
- 커밋 시각: `2026-02-21 21:12:23 +0900`
- 커밋 메시지: `Merge pull request #97 from honki12345/issue-95-bug-api-inbox-source-doc-returns-invalid-input-fetch-failed-in-production`
- 운영 규칙:
  - `main` 변경을 문서에 반영할 때 위 커밋 값을 먼저 갱신한다.
  - 작업 시작 시 기준 커밋이 오래되었으면 `main` 변경 유입 여부를 확인하고 관련 섹션을 재검토한다.

## 1. Project Overview

### Purpose

- 개인 블로그 서비스로, 공개 글 조회(홈/목록/태그/상세)를 제공한다.
- 운영자 전용 워크스페이스(2FA 세션 기반)에서 글/메모/할일/일정을 관리한다.
- 프라이빗 방명록(게스트별 스레드/세션)과 AI 수집 인입 큐를 함께 운영한다.

### Core capabilities

- 공개 웹: `/`, `/posts`, `/posts/[slug]`, `/tags`, `/tags/[tag]`
- 관리자 웹: `/admin/login`, `/admin/write`, `/admin/notes`, `/admin/todos`, `/admin/schedules`, `/admin/guestbook`, `/admin/guestbook/[id]`
- 호환 라우트: `/write`는 `/admin/write`로 리다이렉트(쿼리 유지)
- AI/API Key 경로: `/api/posts`, `/api/posts/bulk`, `/api/posts/[id]`, `/api/posts/check`, `/api/posts/suggest`, `/api/uploads`
- Inbox 경로: `/api/inbox`, `/api/inbox/[id]` (URL host 기반 `x/doc` 자동 판별)
- Admin API 경로: `/api/admin/auth/*`, `/api/admin/posts*`, `/api/admin/notes*`, `/api/admin/todos*`, `/api/admin/schedules*`, `/api/admin/uploads`, `/api/admin/guestbook/*`
- Guestbook API 경로: `/api/guestbook/threads`, `/api/guestbook/login`, `/api/guestbook/thread`, `/api/guestbook/messages`, `/api/guestbook/logout`
- SQLite(better-sqlite3, WAL, FTS5) + 마크다운 렌더링(GFM/Math/Shiki/KaTeX/sanitize)
- Playwright 기반 시각 회귀 + 접근성 + 기능 E2E, step1~step10 스크립트 게이트

### Non-goals / limitations (current implementation)

- 다중 관리자 계정/역할(RBAC)은 없다. 단일 admin 계정+2FA 세션 모델이다.
- API/로그인 레이트리밋은 프로세스 메모리(Map) 기반이라 다중 인스턴스 공유가 없다.
- Guestbook은 공개 댓글 피드가 아니라 스레드 소유자 세션 기반 private inbox 모델이다.
- 분산 세션 저장소(예: Redis)와 중앙 감사 로그 저장소는 구현되어 있지 않다.
- 업로드 URL(`/uploads/...`)의 HTTP 서빙은 런타임/리버스 프록시 설정에 의존한다.

Sources: `AGENTS.md`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/posts/page.tsx`, `src/app/posts/[slug]/page.tsx`, `src/app/tags/page.tsx`, `src/app/tags/[tag]/page.tsx`, `src/app/write/page.tsx`, `src/app/guestbook/page.tsx`, `src/app/admin/login/page.tsx`, `src/app/admin/write/page.tsx`, `src/lib/db.ts`, `src/lib/markdown.ts`

## 2. Architecture

### Component map

| Layer                  | Responsibility                                                       | Key files                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Public pages (RSC)     | 홈/아카이브/태그/상세 조회, admin 세션 여부에 따른 draft 가시성 제어 | `src/app/page.tsx`, `src/app/posts/page.tsx`, `src/app/tags/page.tsx`, `src/app/tags/[tag]/page.tsx`, `src/app/posts/[slug]/page.tsx` |
| Admin pages            | 로그인/글쓰기/메모/할일/일정/방명록 인박스 UI                        | `src/app/admin/**`                                                                                                                    |
| Guestbook pages        | 게스트 스레드 생성/로그인/대화 UI, noindex 페이지                    | `src/app/guestbook/page.tsx`, `src/app/guestbook/GuestbookClient.tsx`                                                                 |
| Public/API key routes  | 포스트 생성/수정/조회/중복검사/업로드/인입큐/헬스체크                | `src/app/api/posts/**`, `src/app/api/uploads/route.ts`, `src/app/api/inbox/**`, `src/app/api/health/route.ts`                         |
| Admin API routes       | 2FA 인증, CSRF 보호 CRUD, 관리자 업로드, 관리자 방명록 응답          | `src/app/api/admin/**`                                                                                                                |
| Guestbook API routes   | 게스트 스레드/로그인/메시지/로그아웃                                 | `src/app/api/guestbook/**`                                                                                                            |
| Auth/session utilities | admin 세션/챌린지/TOTP, CSRF 서명 검증, guestbook 세션               | `src/lib/admin-auth.ts`, `src/lib/admin-csrf.ts`, `src/lib/guestbook.ts`, `src/lib/admin-api.ts`, `src/lib/guestbook-api.ts`          |
| Data layer             | SQLite 연결, 스키마 버전 마이그레이션, FTS/트리거/인덱스             | `src/lib/db.ts`                                                                                                                       |
| Content pipeline       | markdown -> safe HTML + Mermaid client rendering                     | `src/lib/markdown.ts`, `src/components/PostContent.tsx`, `src/components/MermaidDiagram.tsx`                                          |
| Tests                  | 단계별 계약 테스트 + Playwright 시각/기능/a11y 테스트                | `scripts/test-step-*.mjs`, `scripts/test-all.mjs`, `tests/ui/*.spec.ts`                                                               |

### Data/control flow

- 공개 조회 흐름: RSC가 `post-list` 질의로 `published` 중심 데이터를 렌더링하고, admin 세션이 있으면 draft를 함께 노출한다.
- 관리자 인증 흐름: `/api/admin/auth/login`(1차) -> `admin_login_challenge` 쿠키 -> `/api/admin/auth/verify`(2차) -> `admin_session` + `admin_csrf` 쿠키 발급.
- 관리자 콘텐츠 흐름: `/api/admin/posts*`와 `/api/admin/{notes,todos,schedules}*`가 세션+CSRF를 검증하고 DB를 갱신하며 관련 경로를 `revalidatePath` 한다.
- 방명록 흐름: 게스트가 스레드 생성/로그인 시 `guestbook_session` 쿠키 발급 -> 스레드 단위 메시지 작성 -> 관리자가 `/api/admin/guestbook/*`에서 조회/답장.
- Inbox 흐름: `/api/inbox` POST가 URL host 기반으로 `x`/`doc` source를 자동 판별하고 정규화 후 큐 적재(중복은 duplicate 응답).
- 관측 흐름: `POST /api/posts`, `POST /api/posts/bulk`는 요청 요약 구조화 로그를 출력한다.

### External systems

- SQLite 파일 DB (`data/blog.db`, WAL)
- 로컬 파일시스템 업로드 디렉터리 (`uploads/`)
- DNS 조회 + HTTP HEAD/GET 리다이렉트 검사 (`normalizeDocUrl`)를 통한 doc URL 안전성 검증
- 브라우저 쿠키 기반 상태 (`admin_session`, `admin_csrf`, `admin_login_challenge`, `guestbook_session`)
- GitHub Actions CI (`verify`, `ui-visual`) 및 배포 워크플로우(`deploy`)

Sources: `src/app/api/admin/auth/login/route.ts`, `src/app/api/admin/auth/verify/route.ts`, `src/app/api/admin/posts/[id]/route.ts`, `src/app/api/admin/guestbook/threads/[id]/messages/route.ts`, `src/app/api/guestbook/threads/route.ts`, `src/app/api/guestbook/messages/route.ts`, `src/app/api/inbox/route.ts`, `src/lib/inbox-url.ts`, `src/lib/post-list.ts`, `src/lib/db.ts`, `src/lib/admin-auth.ts`, `src/lib/admin-csrf.ts`, `src/lib/guestbook.ts`, `scripts/test-all.mjs`

## 3. API and Runtime Behavior

### Common API conventions

- 기본 에러 응답 형태:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "human readable message",
    "details": null
  }
}
```

- 예외: `POST /api/posts/bulk`는 bulk 계약에 따라 `{ created, errors, code? }` 형태를 사용한다.
- 인증 모델:
  - `Authorization: Bearer <BLOG_API_KEY>`: `/api/posts*`, `/api/uploads`, `/api/inbox*`
  - `admin_session` 쿠키: `/api/admin/*` 조회
  - `admin_session` + `x-csrf-token`/`admin_csrf`: `/api/admin/*` 상태 변경
  - `guestbook_session` 쿠키: `/api/guestbook/thread`, `/api/guestbook/messages`

### Endpoints (selected)

| Method             | Path                                                                          | Auth              | Behavior                                                                  | 주요 오류 코드                                                                          |
| ------------------ | ----------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `GET`              | `/api/health`                                                                 | 선택적 Bearer     | DB 연결 확인, 인증 헤더가 유효하면 `auth: valid` 포함                     | `UNAUTHORIZED`, `INTERNAL_ERROR`                                                        |
| `GET`              | `/api/posts`                                                                  | 없음              | 공개글(`published`) 최신 100개 반환                                       | -                                                                                       |
| `POST`             | `/api/posts`                                                                  | Bearer            | 단건 AI 포스트 생성(origin=`ai`), 태그/출처 저장, revalidate, 구조화 로그 | `UNAUTHORIZED`, `INVALID_INPUT`, `DUPLICATE_SOURCE`, `RATE_LIMITED`, `INTERNAL_ERROR`   |
| `POST`             | `/api/posts/bulk`                                                             | Bearer            | 벌크 생성(최대 10), all-or-nothing, 구조화 로그                           | `UNAUTHORIZED`, `INVALID_INPUT`, `DUPLICATE_SOURCE`, `RATE_LIMITED`, `INTERNAL_ERROR`   |
| `GET`              | `/api/posts/[id]`                                                             | Bearer            | 글+태그 조회                                                              | `UNAUTHORIZED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`                          |
| `PATCH`            | `/api/posts/[id]`                                                             | Bearer            | 제목/본문/상태/태그 부분 수정, `published_at` 전이 처리                   | `UNAUTHORIZED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`                          |
| `GET`              | `/api/posts/check?url=`                                                       | Bearer            | `source_url` 중복 여부 검사                                               | `UNAUTHORIZED`, `INVALID_INPUT`, `INTERNAL_ERROR`                                       |
| `GET`              | `/api/posts/suggest?q=`                                                       | 없음              | typeahead 추천(max 8), admin 세션이면 draft 포함                          | `INTERNAL_ERROR`                                                                        |
| `POST`             | `/api/uploads`                                                                | Bearer            | 이미지 업로드(5MB, png/jpeg/webp/gif, 매직바이트 검사)                    | `UNAUTHORIZED`, `INVALID_INPUT`, `FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`, `INTERNAL_ERROR` |
| `GET`              | `/api/inbox`                                                                  | Bearer            | 인입 큐 조회(status/limit)                                                | `UNAUTHORIZED`, `INVALID_INPUT`, `INTERNAL_ERROR`                                       |
| `POST`             | `/api/inbox`                                                                  | Bearer            | URL host로 `x/doc` 자동 판별 후 정규화/적재(중복은 duplicate)             | `UNAUTHORIZED`, `INVALID_INPUT`, `RATE_LIMITED`, `INTERNAL_ERROR`                       |
| `PATCH`            | `/api/inbox/[id]`                                                             | Bearer            | `queued -> processed                                                      | failed` 상태 전이                                                                       | `UNAUTHORIZED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR` |
| `POST`             | `/api/admin/auth/login`                                                       | 없음              | admin 1차 인증, 챌린지 쿠키 발급                                          | `INVALID_INPUT`, `UNAUTHORIZED`, `RATE_LIMITED`, `INTERNAL_ERROR`                       |
| `GET`              | `/api/admin/auth/totp-setup`                                                  | 챌린지 쿠키       | TOTP 등록 QR 데이터 제공(이미 활성화면 차단)                              | `UNAUTHORIZED`, `TOTP_ALREADY_ENABLED`, `INTERNAL_ERROR`                                |
| `POST`             | `/api/admin/auth/verify`                                                      | 챌린지 쿠키       | TOTP/Recovery 2차 인증, `admin_session`/`admin_csrf` 발급                 | `INVALID_INPUT`, `UNAUTHORIZED`, `RATE_LIMITED`, `INTERNAL_ERROR`                       |
| `POST`             | `/api/admin/auth/logout`                                                      | admin 세션 + CSRF | 세션/CSRF 쿠키 무효화                                                     | `UNAUTHORIZED`, `CSRF_FAILED`                                                           |
| `GET/POST`         | `/api/admin/posts`                                                            | 세션 / 세션+CSRF  | 관리자 글 목록/생성(origin=`original`)                                    | `UNAUTHORIZED`, `CSRF_FAILED`, `INVALID_INPUT`, `INTERNAL_ERROR`                        |
| `GET/PATCH/DELETE` | `/api/admin/posts/[id]`                                                       | 세션 / 세션+CSRF  | 관리자 글 조회/수정/삭제(삭제 시 `sources.post_id` NULL 처리 후 삭제)     | `UNAUTHORIZED`, `CSRF_FAILED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`           |
| `GET/POST`         | `/api/admin/notes`, `/api/admin/todos`, `/api/admin/schedules`                | 세션 / 세션+CSRF  | 관리자 워크스페이스 리소스 목록/생성                                      | `UNAUTHORIZED`, `CSRF_FAILED`, `INVALID_INPUT`, `INTERNAL_ERROR`                        |
| `GET/PATCH/DELETE` | `/api/admin/notes/[id]`, `/api/admin/todos/[id]`, `/api/admin/schedules/[id]` | 세션 / 세션+CSRF  | 워크스페이스 리소스 단건 조회/수정/삭제                                   | `UNAUTHORIZED`, `CSRF_FAILED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`           |
| `POST`             | `/api/admin/uploads`                                                          | 세션+CSRF         | 관리자 업로드(검증 규칙은 `/api/uploads`와 동일)                          | `UNAUTHORIZED`, `CSRF_FAILED`, `INVALID_INPUT`, `INTERNAL_ERROR`                        |
| `GET`              | `/api/admin/guestbook/threads`                                                | 세션              | 방명록 스레드 목록(최근 메시지 미리보기 포함)                             | `UNAUTHORIZED`                                                                          |
| `GET`              | `/api/admin/guestbook/threads/[id]`                                           | 세션              | 스레드+메시지 전체 조회                                                   | `UNAUTHORIZED`, `INVALID_INPUT`, `NOT_FOUND`                                            |
| `POST`             | `/api/admin/guestbook/threads/[id]/messages`                                  | 세션+CSRF         | 관리자 답장 메시지 작성                                                   | `UNAUTHORIZED`, `CSRF_FAILED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`           |
| `POST`             | `/api/guestbook/threads`                                                      | 없음              | 게스트 스레드 생성 + 첫 메시지 + 세션 쿠키 발급                           | `INVALID_INPUT`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`                           |
| `POST`             | `/api/guestbook/login`                                                        | 없음              | 게스트 스레드 로그인 + 세션 쿠키 발급                                     | `INVALID_INPUT`, `UNAUTHORIZED`, `RATE_LIMITED`                                         |
| `GET`              | `/api/guestbook/thread`                                                       | guestbook 세션    | 현재 세션 스레드/메시지 조회                                              | `UNAUTHORIZED`, `NOT_FOUND`                                                             |
| `POST`             | `/api/guestbook/messages`                                                     | guestbook 세션    | 게스트 메시지 추가                                                        | `UNAUTHORIZED`, `INVALID_INPUT`, `RATE_LIMITED`, `INTERNAL_ERROR`                       |
| `POST`             | `/api/guestbook/logout`                                                       | 선택              | 게스트 세션 삭제 + 쿠키 만료                                              | -                                                                                       |

### Doc URL normalization (inbox `doc` path)

- `POST /api/inbox`에서 `source` 필드는 입력받지 않고 URL host로 자동 판별한다.
- `doc` 판별 시 `normalizeDocUrl` 규칙:
  - `https`만 허용, credentials 금지
  - 포트는 비어있음 또는 `:443`만 허용(`:443`은 canonical 저장 시 제거)
  - fragment 제거, tracking query(`utm_*`, `fbclid`, `gclid`, `msclkid`) 제거
  - `localhost`/IP literal 차단 + DNS 결과가 private/loopback/link-local/reserved 대역이면 차단
  - 최대 3 hop 리다이렉트, hop마다 안전성 재검증, timeout 3초, HEAD 우선(405/501이면 GET)
- 테스트 전용으로 `INBOX_DOC_TEST_STUB_NETWORK=1`이면 DNS/fetch를 stub 처리할 수 있다.

### Input/output contracts (selected)

- `POST /api/posts`
  - 입력: `title`, `content`, `status?`, `tags?`, `sourceUrl?`, `aiModel?`, `promptHint?`
  - 출력: `201 { id, slug }`
  - 제약: `sourceUrl` 충돌 시 `409 DUPLICATE_SOURCE`, slug suffix 자동 부여
- `POST /api/posts/bulk`
  - 입력: `{ posts: Array<...> }`, 길이 `1~10`
  - 성공: `201 { created: [{ id, slug }], errors: [] }`
  - 실패: `{ created: [], errors: [...], code }` + `400/409/429/500`
  - 정책: all-or-nothing(부분 성공 없음)
- `POST /api/admin/auth/login`
  - 입력: `{ username, password }`
  - 출력: `200 { requiresTwoFactor: true, totpEnabled: boolean }` + challenge 쿠키
- `POST /api/admin/auth/verify`
  - 입력: `{ code }`
  - 출력: `200 { ok: true, authenticated: true, method: "totp"|"recovery", username }` + 세션/CSRF 쿠키
- `POST /api/guestbook/threads`
  - 입력: `{ username, password, content }`
  - 출력: `201 { threadId, username, createdAt, updatedAt, messages[] }` + guestbook 세션 쿠키

### Auth / permissions and cache behavior

- 공개 페이지(`/`, `/posts`, `/tags`, `/tags/[tag]`)는 기본적으로 `published`만 노출한다.
  - 단, `admin_session`이 유효하면 draft도 함께 노출한다.
  - draft 클릭/선택은 `/admin/write?id={id}`로 이동한다.
- 상세(`/posts/[slug]`)는 `published`만 조회하지만, admin 세션이 있으면 수정/삭제 액션 버튼이 보인다.
- `/write`는 항상 `/admin/write`로 리다이렉트하며 쿼리스트링을 유지한다.
- 관리자 페이지(`/admin/*`)는 서버에서 세션 확인 후 미인증이면 `/admin/login?next=...`로 리다이렉트한다.
- 관리자 상태 변경 API는 signed double-submit CSRF(`x-csrf-token` + `admin_csrf`)를 요구한다.
- 방명록 관련 경로(`/guestbook`, `/api/guestbook/*`, `/admin/guestbook/*`, `/api/admin/guestbook/*`)는 noindex 정책을 적용한다.
- 포스트 생성/수정/삭제 시 홈/목록/상세/태그 경로를 `revalidatePath` 한다.
- `posts.origin`은 immutable 트리거로 보호된다(`ai`/`original`).
- 레이트리밋 기본값:
  - `POST /api/posts`: 10회/60초
  - `POST /api/posts/bulk`: 3회/60초
  - `POST /api/inbox`: 10회/60초(token+ip)
  - `POST /api/admin/auth/login`: 10회/60초(ip)
  - `POST /api/admin/auth/verify`: 10회/60초(ip)
  - `POST /api/guestbook/threads`: 3회/1시간(ip)
  - `POST /api/guestbook/login`: 10회/10분(ip)
  - `POST /api/guestbook/messages`: 30회/10분(ip+thread)

Sources: `src/app/api/posts/route.ts`, `src/app/api/posts/bulk/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/app/api/posts/suggest/route.ts`, `src/app/api/inbox/route.ts`, `src/app/api/inbox/[id]/route.ts`, `src/lib/inbox-url.ts`, `src/app/api/admin/auth/login/route.ts`, `src/app/api/admin/auth/verify/route.ts`, `src/app/api/admin/auth/logout/route.ts`, `src/app/api/admin/posts/[id]/route.ts`, `src/app/api/admin/guestbook/threads/[id]/messages/route.ts`, `src/app/api/guestbook/threads/route.ts`, `src/app/api/guestbook/messages/route.ts`, `src/app/write/page.tsx`, `src/app/posts/[slug]/page.tsx`, `next.config.ts`, `src/lib/rate-limit.ts`, `src/lib/admin-csrf.ts`

## 4. Configuration and Deployment

### Environment variables

| Name                                                                | Required      | Used by                          | Description                                          |
| ------------------------------------------------------------------- | ------------- | -------------------------------- | ---------------------------------------------------- |
| `BLOG_API_KEY`                                                      | Yes (운영)    | API key 보호 라우트, 테스트      | `/api/posts*`, `/api/uploads`, `/api/inbox*` 인증 키 |
| `DATABASE_PATH`                                                     | No            | DB layer, 테스트                 | SQLite 경로 오버라이드(기본 `data/blog.db`)          |
| `NEXT_PUBLIC_SITE_URL`                                              | No            | 메타데이터/테스트                | canonical URL/Playwright base URL 기준               |
| `BLOG_RELEASE_SHA`                                                  | No            | inbox 로깅                       | inbox 실패 로그 배포 리비전 태그                     |
| `GIT_COMMIT_SHA` / `VERCEL_GIT_COMMIT_SHA`                          | No            | inbox 로깅                       | 배포 리비전 fallback                                 |
| `ADMIN_USERNAME`                                                    | Yes (운영)    | admin auth                       | 관리자 계정명                                        |
| `ADMIN_PASSWORD_HASH`                                               | Yes (운영)    | admin auth                       | Argon2id 해시 비밀번호                               |
| `ADMIN_SESSION_SECRET`                                              | Yes (운영)    | admin session/challenge/recovery | 세션 서명/해시용 시크릿                              |
| `ADMIN_TOTP_SECRET_ENCRYPTION_KEY`                                  | Yes (운영)    | admin auth                       | DB 저장 TOTP secret 암복호화 키                      |
| `ADMIN_CSRF_SECRET`                                                 | Yes (운영)    | CSRF                             | signed double-submit CSRF 서명 키                    |
| `ADMIN_TOTP_SECRET`                                                 | 권장(운영)    | admin auth                       | 고정 TOTP 시크릿(미지정 시 파생값 사용)              |
| `ADMIN_TOTP_ISSUER`                                                 | No            | admin auth                       | OTP issuer 문자열(기본 `Honki Blog`)                 |
| `ADMIN_RECOVERY_CODES`                                              | No            | admin auth                       | 복구코드 목록(쉼표/줄바꿈 구분)                      |
| `ADMIN_SESSION_MAX_AGE_SECONDS`                                     | No            | admin auth                       | admin 세션 수명(기본 12시간)                         |
| `ADMIN_LOGIN_RATE_LIMIT_MAX` / `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS`   | No            | admin login                      | 1차 로그인 레이트리밋 설정                           |
| `ADMIN_VERIFY_RATE_LIMIT_MAX` / `ADMIN_VERIFY_RATE_LIMIT_WINDOW_MS` | No            | admin verify                     | 2차 인증 레이트리밋 설정                             |
| `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_MS`                  | No            | `POST /api/posts`                | 단건 생성 레이트리밋                                 |
| `RATE_LIMIT_BULK_MAX_REQUESTS` / `RATE_LIMIT_BULK_WINDOW_MS`        | No            | `POST /api/posts/bulk`           | 벌크 생성 레이트리밋                                 |
| `INBOX_RATE_LIMIT_MAX_REQUESTS` / `INBOX_RATE_LIMIT_WINDOW_MS`      | No            | `POST /api/inbox`                | inbox 인입 레이트리밋                                |
| `INBOX_DOC_TEST_STUB_NETWORK`                                       | No (테스트용) | inbox doc 정규화                 | `1`이면 DNS/fetch stub 사용                          |
| `API_KEY`                                                           | No (테스트용) | Playwright helpers               | 테스트에서 `BLOG_API_KEY` 대체                       |

### Build/deploy paths

- `next.config.ts`
  - `output: "standalone"`
  - `serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"]`
  - guestbook 경로군에 `X-Robots-Tag: noindex, nofollow, noarchive` 헤더 설정
- standalone 산출물 핵심 경로:
  - `.next/standalone/server.js`
  - `.next/static` (standalone 런타임으로 복사 필요)
  - `public/` (standalone 런타임으로 복사 필요)
- Node 엔진 최소 버전: `>=20.9.0`

### Operational notes

- DB 최초 연결 시 마이그레이션 실행, 현재 스키마 버전은 `6`(admin/inbox/guestbook 포함).
- SQLite PRAGMA: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`, `cache_size=-2000`
- 배포 워크플로우는 `/var/lib/blog/{data,uploads}` 영속 경로를 사용하고 릴리즈 디렉토리에 심볼릭 링크를 건다.
- 운영 DB 백업은 `cp` 대신 `sqlite3 .backup` 전략을 사용한다.
- deploy workflow는 admin env 파일(`/etc/blog/admin.env`)을 구성하고 systemd override로 주입한다.

### CI summary

- `verify` job: `npm ci` -> `lint` -> `format:check` -> `build` -> standalone artifact upload -> `test:step3`
- `ui-visual` job: standalone artifact 복원 -> Playwright Chromium 설치 -> viewport matrix(`360/768/1440`) 실행
- `deploy` workflow: `main` push/수동 실행 -> standalone 패키징 -> VM 배포 -> `/api/health` 다중 재시도 -> 실패 시 자동 롤백

Sources: `.env.example`, `package.json`, `next.config.ts`, `src/lib/db.ts`, `src/app/api/inbox/route.ts`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `AGENTS.md`, `docs/runbooks/deploy-log.md`

## 5. Development and Testing

### Local run steps

1. `npm ci`
2. `.env.local`에 `BLOG_API_KEY` 및 admin 필수 변수(`ADMIN_*`) 설정
3. `npm run dev`
4. 필요 시 `npm run db:migrate`로 DB 경로/스키마 버전 확인

### Task Context Map (수동 경로 매핑)

> 자동 스크립트 대신 아래 경로 매핑 표를 작업 시작 체크리스트로 사용한다.

| 작업 유형                | 필수 참고 경로                                                                                                                             | 선택 참고 경로                                                                                                                            | 점검 포인트                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 공통 (모든 작업)         | `docs/codebase.md` (Sync Anchor, Architecture, API), `AGENTS.md`                                                                           | `plans/implementation-plan.md`, `plans/use-cases.md`                                                                                      | 시작 전 동기화 기준 커밋과 운영 규칙 확인  |
| AI/API Key 경로 변경     | `src/app/api/posts/**`, `src/app/api/inbox/**`, `src/app/api/uploads/route.ts`, `src/lib/inbox-url.ts`                                     | `scripts/test-step-3.mjs`, `scripts/test-step-8.mjs`                                                                                      | 인증/정규화/레이트리밋/로그 요약 회귀 확인 |
| 관리자 인증/권한 변경    | `src/lib/admin-auth.ts`, `src/lib/admin-csrf.ts`, `src/app/api/admin/auth/**`, `src/lib/admin-api.ts`                                      | `scripts/test-step-9.mjs`, `tests/ui/admin-*.spec.ts`                                                                                     | 2FA challenge/session/CSRF 계약 확인       |
| 관리자 워크스페이스 변경 | `src/app/admin/**`, `src/app/api/admin/{posts,notes,todos,schedules}/**`                                                                   | `scripts/test-step-9.mjs`, `tests/ui/admin-workspace.spec.ts`                                                                             | 권한/CSRF + revalidate 동작 확인           |
| 방명록 변경              | `src/app/guestbook/**`, `src/app/admin/guestbook/**`, `src/app/api/guestbook/**`, `src/app/api/admin/guestbook/**`, `src/lib/guestbook.ts` | `tests/ui/guestbook-private.spec.ts`, `next.config.ts`, `src/app/robots.ts`                                                               | 세션 격리/noindex/관리자 답장 흐름 확인    |
| 검색/태그/아카이브 변경  | `src/app/posts/page.tsx`, `src/app/tags/**`, `src/app/api/posts/suggest/route.ts`, `src/lib/post-list.ts`                                  | `scripts/test-step-10.mjs`, `tests/ui/posts-archive.spec.ts`, `tests/ui/posts-search-autocomplete.spec.ts`, `tests/ui/tags-index.spec.ts` | FTS 오류 폴백/자동완성/필터 조합 회귀 확인 |
| DB 스키마/마이그레이션   | `src/lib/db.ts`                                                                                                                            | `scripts/test-step-2.mjs`, `scripts/test-all.mjs`                                                                                         | schema version/인덱스/트리거/FTS 영향 확인 |
| 배포/운영 변경           | `.github/workflows/*.yml`, `next.config.ts`                                                                                                | `docs/runbooks/deploy-log.md`, `scripts/test-step-6.mjs`, `scripts/test-step-7-remote.mjs`                                                | standalone/롤백/헬스체크 경로 확인         |
| 테스트 전용 변경         | `scripts/test-step-*.mjs`, `tests/ui/*.spec.ts`, `package.json`                                                                            | `plans/use-cases.md`                                                                                                                      | 테스트 식별자와 유스케이스 매핑 업데이트   |

### Test strategy and commands

- 단계별 스크립트:
  - `npm run test:step1`: build/standalone/dev/env 기본 검증
  - `npm run test:step2`: DB 스키마/FTS/PRAGMA/제약조건 검증
  - `npm run test:step3`: API key 경로(posts/uploads/inbox) 계약 검증
  - `npm run test:step4`: markdown 렌더링/XSS/Mermaid 검증
  - `npm run test:step5`: 공개 페이지/리다이렉트/업로드 통합 검증
  - `npm run test:step6`: CI/CD 게이트 및 standalone 무결성 검증
  - `npm run test:step7-local`, `npm run test:step7-remote`: 로컬/원격 배포 검증
  - `npm run test:step8`: bulk API + 구조화 로그 검증
  - `npm run test:step9`: 관리자 인증/워크스페이스/CSRF 계약 검증
  - `npm run test:step10`: FTS 검색 UI 계약(검색 성공/미스/문법오류 폴백) 검증
  - `npm run test:ui`: Playwright 시각 회귀 + 기능 assertion + 접근성
- 전체 회귀: `npm run test:all`
  - 실행 순서: `step1 -> (step2+step4 병렬) -> step3 -> step5 -> step8 -> step9 -> step10 -> ui(360/768/1440)`
  - `PLAYWRIGHT_SKIP_BUILD=1` 재사용 전략으로 build 중복을 줄인다.

### CI/CD workflow summary

- `ci.yml`: PR/지정 브랜치 push에서 `verify` + `ui-visual`을 실행한다.
- `deploy.yml`: `main` push(path filter) 또는 수동 실행에서만 배포를 수행한다.
- 배포 실패 시 이전 릴리즈 symlink로 롤백하고 서비스 상태를 재검증한다.

Sources: `package.json`, `scripts/test-step-1.mjs`, `scripts/test-step-2.mjs`, `scripts/test-step-3.mjs`, `scripts/test-step-4.mjs`, `scripts/test-step-5.mjs`, `scripts/test-step-6.mjs`, `scripts/test-step-7-remote.mjs`, `scripts/test-step-8.mjs`, `scripts/test-step-9.mjs`, `scripts/test-step-10.mjs`, `scripts/test-all.mjs`, `scripts/test-ui.mjs`, `playwright.config.ts`, `tests/ui/*.spec.ts`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `plans/use-cases.md`

## 6. Extension Points

### Where to add new modules/features

- 신규 공개 API: `src/app/api/<feature>/route.ts` + 공통 에러 포맷 유지
- 신규 관리자 API: `src/app/api/admin/<feature>/route.ts` + `requireAdminSessionWithCsrf` 적용
- 신규 방명록 기능: `src/app/api/guestbook/**`, `src/app/api/admin/guestbook/**`, `src/lib/guestbook.ts`
- DB 확장: `src/lib/db.ts`에서 스키마 SQL + `schema_versions` 마이그레이션 단계 추가
- 검색/목록 확장: `src/lib/post-list.ts`, `src/lib/fts.ts`, `src/app/api/posts/suggest/route.ts`
- UI 확장: `src/app/*` 페이지 + `src/components/*` 분리, Playwright 스냅샷 동반 갱신

### Common pitfalls and invariants

- `posts.origin`은 immutable이다(`ai`는 API key 생성, `original`은 admin 생성).
- `source_url`/`sources.url` 중복은 409로 처리하며 경합 상황에서도 단일 성공만 허용한다.
- `POST /api/inbox`는 `source` 입력을 받지 않는다(서버 자동 판별).
- 관리자 상태 변경 API는 반드시 CSRF 헤더를 요구한다(`admin_csrf` 쿠키와 동일 값).
- `DELETE /api/admin/posts/[id]` 시 `sources.post_id`를 NULL 처리해 출처 URL 유니크 이력을 보존한다.
- `/write`는 호환용 리다이렉트 라우트이며 실 편집 경로는 `/admin/write`다.
- guestbook 관련 경로는 색인 차단(noindex/robots disallow)이 기본이다.
- 레이트리밋은 메모리 기반이므로 수평 확장 시 외부 저장소가 필요하다.
- 구조화 로그에는 요약값만 기록하고 본문 원문(`title`, `content`, `promptHint`)은 기록하지 않는다.

Sources: `src/lib/db.ts`, `src/app/api/posts/route.ts`, `src/app/api/posts/bulk/route.ts`, `src/app/api/inbox/route.ts`, `src/lib/inbox-url.ts`, `src/lib/admin-api.ts`, `src/lib/admin-csrf.ts`, `src/app/api/admin/posts/[id]/route.ts`, `src/app/write/page.tsx`, `src/app/robots.ts`, `next.config.ts`, `src/lib/api-log.ts`
