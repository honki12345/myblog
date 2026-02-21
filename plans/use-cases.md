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
| `VISIBILITY` | 공개/관리자 노출 정책(초안 포함 여부) |

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

### UC-SEARCH-001 검색 자동완성/이동 규칙

- 사전조건: 검색 대상 데이터 존재
- 기본흐름: `/api/posts/suggest?q=...`로 최대 8개 추천 표시
- 예외흐름: FTS 문법 오류성 입력은 200 + 빈 목록 폴백
- 수용기준: 공개 사용자는 published만, admin은 draft 포함 결과 확인
- 연결 테스트: `tests/ui/posts-search-autocomplete.spec.ts`, `tests/ui/posts-archive.spec.ts`

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

### UC-UPLOAD-001 업로드 인증/타입/크기 검증

- 사전조건: 업로드 파일 준비
- 기본흐름: 유효 파일 업로드 시 `201` + `/uploads/...` URL 반환
- 예외흐름: 인증 실패, MIME/매직바이트 불일치, 용량 초과 시 실패
- 수용기준: 실패 케이스는 파일 저장이 발생하지 않아야 함
- 연결 테스트: `scripts/test-step-3.mjs`, `scripts/test-step-9.mjs`

### UC-VISIBILITY-001 공개/관리자 노출 정책

- 사전조건: published와 draft 글이 함께 존재
- 기본흐름: 공개 페이지는 published만 노출, admin은 draft 포함 조회
- 예외흐름: 세션 만료/미인증 상태에서는 draft 비노출
- 수용기준: draft 클릭 시 관리자 편집 경로(`/admin/write?id=...`)로 이동
- 연결 테스트: `tests/ui/draft-visibility.spec.ts`, `tests/ui/write-link-auth.spec.ts`

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
| UC-SEARCH-001 | SEARCH | 자동완성/검색 이동 규칙 | `tests/ui/posts-search-autocomplete.spec.ts`, `tests/ui/posts-archive.spec.ts` | Active |
| UC-ADMIN-001 | ADMIN | 관리자 2FA 로그인/세션 | `scripts/test-step-9.mjs`, `tests/ui/admin-2fa-setup-lock.spec.ts` | Active |
| UC-ADMIN-002 | ADMIN | 워크스페이스 CRUD + CSRF | `scripts/test-step-9.mjs`, `tests/ui/admin-workspace.spec.ts` | Active |
| UC-UPLOAD-001 | UPLOAD | 업로드 인증/유효성 검증 | `scripts/test-step-3.mjs`, `scripts/test-step-9.mjs` | Active |
| UC-VISIBILITY-001 | VISIBILITY | 공개/관리자 노출 정책 | `tests/ui/draft-visibility.spec.ts`, `tests/ui/write-link-auth.spec.ts` | Active |
