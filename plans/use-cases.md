# 유스케이스 명세 및 테스트 추적 (단일 문서)

> 목적: 기능 요구(유스케이스)와 자동화 테스트를 한 파일에서 추적한다.
> 동기화 기준: `docs/codebase.md`의 `Sync Anchor (main)` 값을 기준으로 갱신한다.
> 운영 정책: 유스케이스별 파일 분할은 하지 않고, 이 문서를 단일 소스로 유지한다.

## 1. 운영 규칙

- 기능 변경 시 순서는 `유스케이스 갱신 -> 테스트 갱신 -> 구현`을 기본으로 한다.
- 테스트 변경 시 최소 1개 유스케이스와 연결되어야 한다.
- 유스케이스가 바뀌었는데 연결 테스트가 없으면 TODO 상태로 명시한다.
- 새 테스트 제목에는 가능하면 유스케이스 ID 접두사(`[UC-...]`)를 붙인다.

## 2. UC ID 규칙

- 형식: `UC-{CATEGORY}-{NUMBER}`
- 예시: `UC-POST-001`, `UC-ADMIN-002`
- 번호는 카테고리별 3자리 증가값을 사용한다.

## 3. 카테고리 정의

| 카테고리 | 의미 |
| --- | --- |
| `POST` | 단건 글 생성/수정/slug/게시 상태 전이 |
| `BULK` | 벌크 생성 계약(원자성/개수 제한/경합) |
| `INBOX` | URL 수집 큐 적재/조회/상태 갱신 |
| `SEARCH` | 검색/자동완성/아카이브 필터 동작 |
| `ADMIN` | 관리자 로그인(2FA), 세션, CSRF, 워크스페이스 |
| `UPLOAD` | 이미지 업로드 인증/검증/저장 |
| `VISIBILITY` | 라우트 접근 제어/리다이렉트 정책(관리자 전용 경로 포함) |
| `WIKI` | 댓글 태그 경로 기반 위키 조회/관리자 댓글 CRUD |
| `UI` | 다크 모드/고대비 접근성/시각 회귀 품질 게이트 |

## 4. 유스케이스 명세

### UC-POST-001 단건 글 생성 성공

- 사전조건: 유효한 `BLOG_API_KEY`, 필수 필드(`title`, `content`) 제공
- 기본흐름: `POST /api/posts` 호출 -> `201` + `{ id, slug }` 반환
- 예외흐름: 인증 실패 `401`, 입력 오류 `400`, 레이트리밋 `429`
- 수용기준: 저장된 글을 `GET /api/posts/:id`로 조회 가능
- 연결 테스트: `scripts/test-step-3.mjs`, `tests/ui/admin-write-e2e.spec.ts`

### UC-POST-002 출처 URL 중복 차단

- 사전조건: 동일 `sourceUrl`로 이미 등록된 글 존재
- 기본흐름: 동일 URL로 재요청 시 `409 DUPLICATE_SOURCE`
- 예외흐름: URL 형식 오류 시 `400`
- 수용기준: 기존 데이터가 변경되지 않고 단일 원본만 유지
- 연결 테스트: `scripts/test-step-3.mjs`

### UC-POST-003 제목 중복 시 slug suffix 부여

- 사전조건: 동일 제목 글이 이미 존재
- 기본흐름: 두 번째 생성 요청 시 고유 slug(`-2`, `-3`...) 생성
- 예외흐름: 저장 실패 시 `500`
- 수용기준: slug 충돌 없이 permalink가 고유하게 유지
- 연결 테스트: `scripts/test-step-3.mjs`

### UC-POST-004 draft -> published 전이와 발행일 보존

- 사전조건: `draft` 상태 글 존재
- 기본흐름: `PATCH /api/posts/:id`로 `status=published` 전이
- 예외흐름: 없는 ID는 `404`, 인증 실패 `401`
- 수용기준: 첫 publish 시 `published_at` 설정, 재발행 시 기존 값 유지
- 연결 테스트: `scripts/test-step-3.mjs`, `tests/ui/draft-visibility.spec.ts`

### UC-BULK-001 벌크 생성 계약(최대 10건, all-or-nothing)

- 사전조건: 유효한 `BLOG_API_KEY`, `posts.length`가 `1~10`
- 기본흐름: `POST /api/posts/bulk` 성공 시 모든 항목 생성
- 예외흐름: 유효성/중복/레이트리밋 실패 시 전체 롤백
- 수용기준: 부분 성공이 없어야 하며 실패 시 `created`는 빈 배열
- 연결 테스트: `scripts/test-step-8.mjs`

### UC-INBOX-001 URL 수집 큐 적재/중복 처리

- 사전조건: `source`가 `x` 또는 `doc`, 유효 토큰 보유
- 기본흐름: `POST /api/inbox`로 `queued` 항목 생성
- 예외흐름: 중복은 `200 duplicate`, 입력 오류 `400`
- 수용기준: `GET /api/inbox` 결과에 적재 항목이 반영
- 연결 테스트: `scripts/test-step-3.mjs`

### UC-INBOX-002 수집 큐 상태 전이 제한

- 사전조건: `queued` 상태 항목 존재
- 기본흐름: `PATCH /api/inbox/:id`로 `processed|failed` 전이
- 예외흐름: 잘못된 전이/ID/입력은 `400` 또는 `404`
- 수용기준: `failed` 전이 시 error 메시지 저장 가능
- 연결 테스트: `scripts/test-step-3.mjs`

### UC-SEARCH-001 관리자 전용 검색 자동완성/이동 규칙

- 사전조건: 검색 대상 데이터 존재 + 유효한 관리자 세션
- 기본흐름: `/posts`에서 검색/필터를 적용하고 `/api/posts/suggest?q=...`로 최대 8개 추천 표시
- 예외흐름: 비관리자 `/posts` 접근은 `/admin/login?next=...` 리다이렉트, 비관리자 `/api/posts/suggest`는 `401`, FTS 문법 오류성 입력은 관리자 화면에서 메시지 폴백
- 수용기준: 관리자 세션에서 draft+published 검색이 가능하고, 비관리자 접근은 페이지/API 모두 차단 계약을 만족
- 연결 테스트: `scripts/test-step-10.mjs`, `tests/ui/posts-search-autocomplete.spec.ts`, `tests/ui/posts-archive.spec.ts`

### UC-SEARCH-002 관리자 `/posts` 미읽음 필터 및 기본 정렬

- 사전조건: 관리자 세션 + 읽음/미읽음 상태가 섞인 게시글 데이터 존재
- 기본흐름: `/posts` 기본 진입 시 `미읽음 우선(is_read ASC) -> 최신순(datetime(COALESCE(published_at, created_at)) DESC) -> id DESC` 정렬이 적용되고, `read=unread`(미읽음 탭)에서 미읽음만 노출된다.
- 예외흐름: 잘못된 `read` 쿼리값은 `all`로 폴백하고 페이지는 정상 렌더링된다.
- 수용기준: 읽은 최신 글보다 미읽음 글이 먼저 노출되고, 미읽음 탭 전환/페이지네이션/검색 쿼리에서도 `read` 파라미터가 보존된다.
- 연결 테스트: `scripts/test-step-10.mjs`, `tests/ui/posts-archive.spec.ts`, `tests/ui/visual-regression.spec.ts`

### UC-ADMIN-001 관리자 로그인(비밀번호 + TOTP)과 세션 발급

- 사전조건: admin 계정과 TOTP 시크릿 준비
- 기본흐름: `/api/admin/auth/login` -> `/api/admin/auth/verify` -> `admin_session`/`admin_csrf` 발급
- 예외흐름: 잘못된 코드/재사용 코드는 실패 처리
- 수용기준: 인증 이후 `/admin/*` 접근 가능, 로그아웃 시 세션 무효화
- 연결 테스트: `scripts/test-step-9.mjs`, `tests/ui/admin-2fa-setup-lock.spec.ts`

### UC-ADMIN-002 관리자 워크스페이스 CRUD + CSRF 보호

- 사전조건: 유효한 관리자 세션 보유
- 기본흐름: notes/todos/schedules CRUD 요청 성공
- 예외흐름: CSRF 헤더 누락 또는 익명 요청은 `401/403`
- 수용기준: 데이터 CRUD와 보안 제약이 동시에 충족
- 연결 테스트: `scripts/test-step-9.mjs`, `tests/ui/admin-workspace.spec.ts`

### UC-ADMIN-003 관리자 글 읽음 메타데이터 토글(`isRead`)

- 사전조건: 유효한 관리자 세션 + `admin_csrf` 쿠키 보유, 대상 글 존재
- 기본흐름: `/posts/[slug]` 관리자 액션 또는 `PATCH /api/admin/posts/:id`에서 `isRead` 값을 변경하면 DB `posts.is_read`가 갱신된다.
- 예외흐름: CSRF 누락은 `401/403`, 잘못된 `isRead` 타입은 `400`, 없는 글 ID는 `404`
- 수용기준: API 응답에 변경된 `is_read`가 반영되고 상세 화면 버튼 라벨(`읽음으로 표시`/`읽지 않음으로 표시`)이 상태와 일치한다. `360` 뷰포트에서는 관리자 액션이 `수정 -> 읽음 토글 -> 삭제` 세로 스택을 유지하고, 진행 라벨(`변경 중…`/`삭제 중…`)에서도 수평 오버플로우/겹침이 발생하지 않는다.
- 연결 테스트: `scripts/test-step-9.mjs`, `scripts/test-step-10.mjs`, `tests/ui/post-admin-actions.spec.ts`, `tests/ui/visual-regression.spec.ts`, `tests/ui/dark-mode-risk.spec.ts`

### UC-UPLOAD-001 업로드 인증/타입/크기 검증

- 사전조건: 업로드 파일 준비
- 기본흐름: 유효 파일 업로드 시 `201` + `/uploads/...` URL 반환
- 예외흐름: 인증 실패, MIME/매직바이트 불일치, 용량 초과 시 실패
- 수용기준: 실패 케이스는 파일 저장이 발생하지 않아야 함
- 연결 테스트: `scripts/test-step-3.mjs`, `scripts/test-step-9.mjs`

### UC-VISIBILITY-001 홈 canonical redirect + 포스트 경로 관리자 전용 접근 정책

- 사전조건: published/draft 글 데이터 존재
- 기본흐름: `/` 접근은 `308`으로 `/wiki`에 canonical 리다이렉트되고, `/posts`, `/posts/[slug]`, `/tags`, `/tags/[tag]`는 `/admin/login?next=...`로 이동한다. 관리자 세션에서는 `/wiki`에서 위키 탐색 접근이 가능하고 `/posts`, `/posts/[slug]` 접근이 허용된다.
- 예외흐름: `/tags/[tag]`가 위키 경로 규칙으로 변환되지 않으면 `404`; 비관리자 `GET /api/posts`, `GET /api/posts/suggest`는 `401`
- 수용기준: `/`는 항상 `/wiki`로 영구 리다이렉트된다. 헤더 타이틀 링크 목적지는 `/wiki`로 일관되고, `/wiki` 인덱스에서 재클릭 시 URL을 유지한 채 최상단으로 복원된다. `/wiki/[...path]`에서 타이틀 클릭 시 URL과 화면이 함께 `/wiki` 루트로 동기화되어야 하며 수정키(⌘/Ctrl/Shift/Alt)/중클릭 입력에서는 `preventDefault` 없이 기본 링크 동작을 유지한다. `aria-current="page"`는 `/wiki` 인덱스에서만 노출된다. 헤더 `nav[aria-label="주요 메뉴"]` 인터랙티브 항목 순서는 비로그인 시 `위키 -> 로그인`, 로그인 시 `위키 -> 글 목록 -> 글쓰기 -> 로그아웃`을 유지한다. `/tags`는 관리자 시 `/wiki`로, `/tags/[tag]`는 관리자 시 `/wiki/[...path]`로 통합된다.
- 연결 테스트: `scripts/test-step-5.mjs`, `scripts/test-step-10.mjs`, `tests/ui/draft-visibility.spec.ts`, `tests/ui/home-empty-state.spec.ts`, `tests/ui/home-scroll-top.spec.ts`, `tests/ui/tags-index.spec.ts`, `tests/ui/write-link-auth.spec.ts`, `tests/ui/post-admin-actions.spec.ts`

### UC-WIKI-001 관리자 댓글 CRUD + 태그 경로 검증/CSRF

- 사전조건: 유효한 관리자 세션 + `admin_csrf` 쿠키
- 기본흐름: `POST/PATCH/DELETE /api/admin/posts/:id/comments*`로 댓글 생성/수정/삭제
- 예외흐름: 익명/세션 누락 `401`, CSRF 누락 `403`, 태그 경로 형식 오류 `400`
- 수용기준: 태그 경로가 소문자 규칙(`^[a-z0-9-]+(?:/[a-z0-9-]+)*$`)으로 정규화되고 댓글 상태 변경 후 위키 경로 반영
- 연결 테스트: `scripts/test-step-11.mjs`, `tests/ui/wiki-view.spec.ts`

### UC-WIKI-002 공개 위키 트리/경로 조회 + 내용/태그 검색 + 숨김/삭제 비노출

- 사전조건: 댓글 + 태그 경로 데이터 존재
- 기본흐름: `/api/wiki`, `/api/wiki/[...path]`, `/wiki`, `/wiki/[...path]`에서 카테고리 트리/브레드크럼/원문 링크를 조회하고, 검색 파라미터(`q`, `tagPath`, `sort`, `limit`)로 내용/태그 필터를 단독 또는 조합으로 적용한다. `/`는 `/wiki`로 리다이렉트된다. 위키 탐색 셸은 경로 선택 시 URL을 `push/replace` 정책으로 동기화하며, 활성(검은색) 경로 재클릭 시 선택 경로/URL/history를 유지한 채 하위 트리를 `닫기 -> 재열기` 토글한다. `/api/wiki?limit=...`처럼 `q/tagPath/sort` 없이 `limit`만 전달된 요청은 검색 모드로 전환하지 않고 루트 overview 응답 형태를 유지한다.
- 예외흐름: 잘못된 경로/검색 파라미터는 `400`, 존재하지 않는 경로는 `404`, `/api/wiki/[...path]`에 `tagPath`를 함께 전달하면 `400 INVALID_INPUT`
- 수용기준: 공개 조회/검색에서 `is_hidden=0 AND deleted_at IS NULL`만 노출되고 하위 경로 집계가 일관된다. 키워드+태그 조합 기본 정렬은 `관련도 -> updated_at DESC -> id DESC`를 따른다. 댓글 카드 메타 상단은 `왼쪽(tagPath + blog title) / 오른쪽(updated)` 2열로 정렬되고, 블로그 제목은 상단에서 강조 스타일로 노출된다. 댓글 카드 하단은 제목 텍스트 없이 링크(`블로그 글 보기`, `원문 링크`)만 렌더링하며, 두 링크가 모두 없으면 하단 링크 행을 렌더링하지 않는다. 비관리자 세션에서는 댓글 영역의 `블로그 글 보기` 링크가 DOM에 노출되지 않는다. 활성 경로 재클릭 토글 동안 `window.history.length`가 증가하지 않고 선택 경로/URL(`/wiki/{path}`)이 유지된다. 동일 출처 절대 URL(`https://.../wiki`, `https://.../wiki?x=1#y`) 클릭은 인플레이스 탐색으로 인터셉트되어 쿼리/해시를 제거한 `/wiki`로 정규화되고 Back/Forward 히스토리가 유지된다. 위키 헤딩은 `위키`로 일관되며 인플레이스 탐색 이후 Back/Forward 및 새로고침 시 동일 경로 컨텍스트를 복원한다. 검색 상태 UX(로딩/빈 결과/에러/재시도)가 일관되게 동작하며, 동시 검색 요청 시 최신 요청 결과가 최종 상태를 덮어써야 한다. 검색 입력 미충족 오류(`검색어 또는 태그 경로를 입력해 주세요.`)에서는 재시도 버튼이 노출되지 않는다. 상세 화면의 상위 버튼 라벨은 `상위 경로 (/wiki/...)` 형식으로 목적지를 노출하고, 루트 직하위 경로에서도 `href=/wiki` 활성 링크를 유지한다. `360/768/1440` 뷰포트에서 긴 목적지 라벨이 수평 오버플로우를 유발하지 않는다.
- 연결 테스트: `scripts/test-step-11.mjs`, `tests/ui/accessibility.spec.ts`, `tests/ui/wiki-view.spec.ts`, `tests/ui/visual-regression.spec.ts`

### UC-UI-001 다크 모드/고대비 UI 가독성 및 회귀 기준

- 사전조건: `prefers-color-scheme: dark` 또는 `forced-colors/prefers-contrast` 환경에서 공개/관리자 주요 화면에 접근 가능
- 기본흐름: 다크 토큰/상태색/포커스 링을 적용한 UI에서 핵심 화면(`/wiki`, `/posts`, `/posts/[slug]`, `/admin/login`, `/admin/write`)과 관리자 워크스페이스(`/admin/notes`, `/admin/todos`, `/admin/schedules`, `/admin/guestbook`)를 렌더링한다.
- 예외흐름: 접근성 위반(serious/critical), 수평 오버플로우, 시각 회귀 diff 초과가 발생하면 실패 처리한다.
- 수용기준: `360/768/1440` 뷰포트에서 다크 모드 스냅샷 회귀가 안정적으로 유지되고, `forced-colors`/`prefers-contrast` 조건에서도 주요 컨트롤이 포커스/조작 가능하며 axe serious/critical 위반이 0건이다.
- 연결 테스트: `tests/ui/dark-mode-risk.spec.ts`, `tests/ui/accessibility.spec.ts`, `tests/ui/visual-regression.spec.ts`

## 5. Traceability Matrix

| UC ID | 카테고리 | 유스케이스 | 연결 테스트(주요) | 상태 |
| --- | --- | --- | --- | --- |
| UC-POST-001 | POST | 단건 글 생성 성공 | `scripts/test-step-3.mjs`, `tests/ui/admin-write-e2e.spec.ts` | Active |
| UC-POST-002 | POST | 출처 URL 중복 차단 | `scripts/test-step-3.mjs` | Active |
| UC-POST-003 | POST | 제목 중복 slug suffix | `scripts/test-step-3.mjs` | Active |
| UC-POST-004 | POST | draft/published 전이 | `scripts/test-step-3.mjs`, `tests/ui/draft-visibility.spec.ts` | Active |
| UC-BULK-001 | BULK | 벌크 생성 원자성/개수 제한 | `scripts/test-step-8.mjs` | Active |
| UC-INBOX-001 | INBOX | URL 수집 큐 적재/중복 | `scripts/test-step-3.mjs` | Active |
| UC-INBOX-002 | INBOX | 수집 큐 상태 전이 제한 | `scripts/test-step-3.mjs` | Active |
| UC-SEARCH-001 | SEARCH | 관리자 전용 자동완성/검색 이동 규칙 | `scripts/test-step-10.mjs`, `tests/ui/posts-search-autocomplete.spec.ts`, `tests/ui/posts-archive.spec.ts` | Active |
| UC-SEARCH-002 | SEARCH | 관리자 `/posts` 미읽음 필터 및 기본 정렬 | `scripts/test-step-10.mjs`, `tests/ui/posts-archive.spec.ts`, `tests/ui/visual-regression.spec.ts` | Active |
| UC-ADMIN-001 | ADMIN | 관리자 2FA 로그인/세션 | `scripts/test-step-9.mjs`, `tests/ui/admin-2fa-setup-lock.spec.ts` | Active |
| UC-ADMIN-002 | ADMIN | 워크스페이스 CRUD + CSRF | `scripts/test-step-9.mjs`, `tests/ui/admin-workspace.spec.ts` | Active |
| UC-ADMIN-003 | ADMIN | 관리자 글 읽음 메타데이터 토글(`isRead`) | `scripts/test-step-9.mjs`, `scripts/test-step-10.mjs`, `tests/ui/post-admin-actions.spec.ts`, `tests/ui/visual-regression.spec.ts`, `tests/ui/dark-mode-risk.spec.ts` | Active |
| UC-UPLOAD-001 | UPLOAD | 업로드 인증/유효성 검증 | `scripts/test-step-3.mjs`, `scripts/test-step-9.mjs` | Active |
| UC-VISIBILITY-001 | VISIBILITY | 홈 canonical redirect + 포스트 경로 관리자 전용 접근 정책 | `scripts/test-step-5.mjs`, `scripts/test-step-10.mjs`, `tests/ui/draft-visibility.spec.ts`, `tests/ui/home-empty-state.spec.ts`, `tests/ui/home-scroll-top.spec.ts`, `tests/ui/tags-index.spec.ts`, `tests/ui/write-link-auth.spec.ts`, `tests/ui/post-admin-actions.spec.ts` | Active |
| UC-WIKI-001 | WIKI | 관리자 댓글 CRUD + 태그 경로 검증 | `scripts/test-step-11.mjs`, `tests/ui/wiki-view.spec.ts` | Active |
| UC-WIKI-002 | WIKI | 공개 위키 트리/경로 조회 + 내용/태그 검색 + 숨김/삭제 비노출 + limit 단독 호환/검색 레이스 방지 + 상위경로 목적지 라벨 UX + 재클릭 토글 history 불변 + 댓글 메타 2열 정렬/링크 행 조건 렌더 + same-origin 절대 `/wiki` 링크 정규화 | `scripts/test-step-11.mjs`, `tests/ui/accessibility.spec.ts`, `tests/ui/wiki-view.spec.ts`, `tests/ui/visual-regression.spec.ts` | Active |
| UC-UI-001 | UI | 다크 모드/고대비 UI 가독성 및 회귀 기준 | `tests/ui/dark-mode-risk.spec.ts`, `tests/ui/accessibility.spec.ts`, `tests/ui/visual-regression.spec.ts` | Active |

## 6. 테스트 게이트 정책

- PR 빠른 게이트(`npm run test:quick`)
  - 목적: 피드백 속도 우선, 핵심 계약 회귀 조기 탐지
  - 구성: `step1`, `step2`, `step4`, `step3`, `step5`, `step8`, `test:ui:fast(functional + desktop-1440)`
- Main/Nightly 전체 게이트(`npm run test:all`)
  - 목적: 회귀 누락 방지, 릴리즈 품질 최종 보증
  - 구성: `step1~step11` + `test:ui:functional(desktop-1440)` + `test:ui:visual(360/768/1440)`
- 승격 규칙(quick -> full)
  - 최근 `test:quick` 통과 후 `test:all`에서만 발견되는 회귀는 원인 확정 후 다음 사이클에 quick 세트로 승격 후보 등록
  - 승격 기준: 최근 N회(기본 5회)에서 재현 가능한 deterministic 실패이며 flaky(재시도 의존) 성격이 아닐 것
  - 적용 시점: 이슈/PR에서 테스트 변경과 함께 `plans/use-cases.md` Traceability Matrix를 동시 갱신
