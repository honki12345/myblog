# Honki Codebase Documentation Pack

## 1. Project Overview

### Purpose

- 개인 블로그 서비스로, 공개 글 조회(홈/목록/태그/상세)와 인증 기반 글 작성/수정 API를 제공한다.
- 저장소 문서에는 "AI(크론잡) 수집 글 + 직접 작성 글" 목적이 명시되어 있다.

### Core capabilities

- Next.js App Router 기반 웹 페이지: `/`, `/posts`, `/posts/[slug]`, `/tags/[tag]`, `/write`
- SQLite(better-sqlite3) 기반 글/태그/출처 저장 및 FTS5 인덱스 유지
- API Key(Bearer) 기반 보호 API: 단건/벌크 글 생성, 글 수정/조회, 출처 중복 확인, 이미지 업로드
- iOS Shortcuts URL 수집 큐 API: `/api/inbox`(POST/GET) + `/api/inbox/:id`(PATCH), Bearer `BLOG_API_KEY` 기반 적재/조회/상태 갱신
- 마크다운 렌더링 파이프라인: GFM + 수식(KaTeX) + 코드 하이라이트(Shiki) + sanitize + Mermaid placeholder
- API 요청 구조화 로그(JSON): `timestamp`, `route`, `status`, `durationMs`, `postCount`, `contentLengthSum`, `sourceUrlCount`, `payloadHash`
- Playwright 기반 시각 회귀 + 접근성 + 작성 E2E 테스트

### Non-goals / limitations (current implementation)

- 다중 사용자/계정 권한 모델은 없다. 단일 `BLOG_API_KEY`로 보호한다.
- 레이트 리밋은 프로세스 메모리(Map) 기반이라 멀티 인스턴스 간 공유되지 않는다.
- `DELETE /api/posts/...` 같은 삭제 API는 없다.
- 저장소 내에는 크론 스크래퍼/배포 스크립트(Caddy/systemd 설정 파일) 구현이 없다.
- 업로드 URL(`/uploads/...`)의 HTTP 서빙 매핑은 앱 코드에 없고 런타임/프록시 구성에 의존한다.

Sources: `AGENTS.md`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/posts/page.tsx`, `src/app/posts/[slug]/page.tsx`, `src/app/tags/[tag]/page.tsx`, `src/app/write/page.tsx`, `src/lib/db.ts`, `src/lib/markdown.ts`, `src/lib/rate-limit.ts`, `src/lib/api-log.ts`, `src/app/api/posts/route.ts`, `src/app/api/posts/bulk/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/app/api/posts/check/route.ts`, `src/app/api/uploads/route.ts`

## 2. Architecture

### Component map

| Layer                         | Responsibility                                              | Key files                                                                                                    |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| App pages (Server Components) | 공개 화면 렌더링, DB 직접 조회                              | `src/app/page.tsx`, `src/app/posts/page.tsx`, `src/app/posts/[slug]/page.tsx`, `src/app/tags/[tag]/page.tsx` |
| Write UI (Client Component)   | API Key 인증, 작성/수정 폼, 미리보기, 업로드 호출           | `src/app/write/page.tsx`                                                                                     |
| API routes                    | 인증/검증/트랜잭션/에러 응답/캐시 무효화                    | `src/app/api/**/route.ts`                                                                                    |
| Data access                   | SQLite 연결, PRAGMA 설정, 스키마/마이그레이션               | `src/lib/db.ts`                                                                                              |
| Content pipeline              | markdown -> HTML (Shiki/KaTeX/Mermaid placeholder/sanitize) | `src/lib/markdown.ts`, `src/components/PostContent.tsx`, `src/components/MermaidDiagram.tsx`                 |
| Shared UI                     | 카드/태그 렌더링                                            | `src/components/PostCard.tsx`, `src/components/TagList.tsx`                                                  |
| Tests                         | 단계별 검증 + Playwright UI/접근성/시각 회귀                | `scripts/test-step-*.mjs`, `tests/ui/*.spec.ts`                                                              |

### Data/control flow

- 읽기 경로: Server Component가 `getDb()`로 SQLite 조회 -> 게시 상태(`published`) 중심 필터 -> JSX 렌더링
- 작성 경로: `/write`에서 API Key 확인(`/api/health`) -> `POST /api/posts`, `POST /api/posts/bulk`, `PATCH /api/posts/:id` -> DB 트랜잭션 -> `revalidatePath`로 홈/목록/상세/태그 갱신 -> 상태 기반 라우팅(`published`는 `/posts/{slug}`, 목록에서 `draft`는 `/admin/write?id={id}`)
- 렌더링 경로: 상세 페이지에서 `renderMarkdown()` 호출 -> Mermaid 블록은 base64 placeholder로 출력 -> 클라이언트에서 `mermaid` 동적 import 후 SVG 변환
- 업로드 경로: `/api/uploads`가 MIME + 매직바이트 검증 후 `uploads/YYYY/MM/uuid.ext` 저장 -> URL 반환
- 관측 경로: `POST /api/posts`, `POST /api/posts/bulk`는 요청 요약(JSON) 로그를 stdout으로 출력하며 systemd journal에서 수집 가능

### External systems

- SQLite 파일 DB (`data/blog.db`, WAL 모드)
- 로컬 파일시스템 업로드 디렉터리(`uploads/`)
- 브라우저 `localStorage`(write 페이지의 API Key 보관)
- GitHub Actions CI (lint/format/build/API/UI tests)

Sources: `src/lib/db.ts`, `src/app/api/posts/route.ts`, `src/app/api/posts/bulk/route.ts`, `src/lib/api-log.ts`, `src/app/api/posts/[id]/route.ts`, `src/lib/markdown.ts`, `src/components/PostContent.tsx`, `src/components/MermaidDiagram.tsx`, `src/app/write/page.tsx`, `src/app/api/uploads/route.ts`, `tests/ui/helpers.ts`, `.github/workflows/ci.yml`

## 3. API and Runtime Behavior

### Common API conventions

- 에러 응답 공통 형태:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "human readable message",
    "details": {}
  }
}
```

- 인증: `Authorization: Bearer <BLOG_API_KEY>`
- 인증 함수는 `crypto.timingSafeEqual` 기반 비교를 사용한다.

### Endpoints

| Method  | Path                       | Auth                                     | Behavior                                                                                          | 주요 오류 코드                                                                          |
| ------- | -------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`   | `/api/health`              | 선택적(Authorization 헤더가 있으면 검증) | DB 연결 확인. 인증 헤더 유효 시 `auth: "valid"` 포함                                              | `UNAUTHORIZED`, `INTERNAL_ERROR`                                                        |
| `POST`  | `/api/inbox`               | 필수                                     | iOS Shortcuts URL 인입. X/Twitter URL 검증/정규화 후 `queued`로 적재(중복은 200 duplicate)        | `UNAUTHORIZED`, `INVALID_INPUT`, `RATE_LIMITED`, `INTERNAL_ERROR`                       |
| `GET`   | `/api/inbox`               | 필수                                     | 수집 큐 조회. 기본 `status=queued`, `limit=50`(max 100), 오래된 순(`id ASC`)                      | `UNAUTHORIZED`, `INVALID_INPUT`, `INTERNAL_ERROR`                                       |
| `PATCH` | `/api/inbox/:id`           | 필수                                     | 수집 큐 상태 갱신. `queued`만 `processed`/`failed`로 전이 허용, `failed`에서 `error` 저장         | `UNAUTHORIZED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`                          |
| `GET`   | `/api/posts`               | 없음                                     | 최신 100개 공개 글(`published`)만 반환                                                            | -                                                                                       |
| `POST`  | `/api/posts`               | 필수                                     | 단건 글 생성, slug 자동 생성, 태그/출처(ai metadata 포함) 저장, 구조화 로그 출력, 경로 revalidate | `UNAUTHORIZED`, `INVALID_INPUT`, `DUPLICATE_SOURCE`, `RATE_LIMITED`, `INTERNAL_ERROR`   |
| `POST`  | `/api/posts/bulk`          | 필수                                     | 벌크 글 생성(최대 10건), 단일 트랜잭션(all-or-nothing), 구조화 로그 출력, 경로 revalidate         | `UNAUTHORIZED`, `INVALID_INPUT`, `DUPLICATE_SOURCE`, `RATE_LIMITED`, `INTERNAL_ERROR`   |
| `GET`   | `/api/posts/check?url=...` | 필수                                     | `source_url` 중복 여부 확인                                                                       | `UNAUTHORIZED`, `INVALID_INPUT`, `INTERNAL_ERROR`                                       |
| `GET`   | `/api/posts/:id`           | 필수                                     | 글 단건 + 태그 배열 반환                                                                          | `UNAUTHORIZED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`                          |
| `PATCH` | `/api/posts/:id`           | 필수                                     | 제목/본문/상태/태그 부분 수정, `published_at` 전이 처리, 경로 revalidate                          | `UNAUTHORIZED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`                          |
| `POST`  | `/api/uploads`             | 필수                                     | 이미지 업로드(최대 5MB, png/jpeg/webp/gif) 후 URL 반환                                            | `UNAUTHORIZED`, `INVALID_INPUT`, `FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`, `INTERNAL_ERROR` |

### Inbox curl quickstart

```bash
# enqueue (201 queued, 200 duplicate)
curl -sS -X POST "https://<host>/api/inbox" \
  -H "Authorization: Bearer $BLOG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://x.com/i/web/status/123","source":"x","client":"ios_shortcuts","note":"optional note"}'

# list queued
curl -sS "https://<host>/api/inbox" \
  -H "Authorization: Bearer $BLOG_API_KEY"

# update status (queued -> processed|failed)
curl -sS -X PATCH "https://<host>/api/inbox/1" \
  -H "Authorization: Bearer $BLOG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"processed"}'

# rate limit (repeat quickly until you get 429 + Retry-After header)
curl -i -sS -X POST "https://<host>/api/inbox" \
  -H "Authorization: Bearer $BLOG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://x.com/i/web/status/123","source":"x","client":"ios_shortcuts"}'
```

### Input/output contracts (selected)

- `POST /api/posts`
  - 입력: `title(<=200)`, `content(<=100000)`, `status(draft|published)`, `tags(<=10, 각 <=30)`, `sourceUrl(url, <=2048, optional)`, `aiModel(optional)`, `promptHint(optional)`
  - 출력: `201 { id, slug }`
  - 제한: 같은 `sourceUrl`은 409, 같은 제목은 slug suffix(`-2`, `-3`...) 부여
- `POST /api/posts/bulk`
  - 입력: `{ posts: Array<{ title, content, tags?, sourceUrl?, status?, aiModel?, promptHint? }> }`
  - 제약: `posts.length`는 `1~10`
  - 성공: `201 { created: [{ id, slug }], errors: [] }`
  - 실패: `400/409/429 { created: [], errors: [...], code }`
  - 정책: all-or-nothing(부분 성공 없음)
- `PATCH /api/posts/:id`
  - 입력: `title|content|status|tags` 중 최소 1개 필요
  - 동작: `published_at`은 처음 `published` 될 때만 설정되고 이후 재발행에서는 유지
- `POST /api/uploads`
  - 파일 필드명: `file`
  - 저장 위치: `uploads/<YYYY>/<MM>/<uuid>.<ext>`
  - 출력: `201 { url: "/uploads/..." }`

### Auth / permissions and cache behavior

- 공개 페이지(`/`, `/posts`, `/tags`, `/tags/[tag]`)는 기본적으로 `status='published'`만 노출한다.
  - 단, 관리자 세션(`admin_session` 쿠키)이 유효하면 목록 페이지에서 `draft`도 함께 노출한다.
  - 목록에서 `draft` 클릭 시 편집기로 이동한다: `/admin/write?id={id}`
- `/`은 탐색 시작점이다: 태그 허브 + 최신 직접 작성 5 + 최신 AI 수집 5 + CTA.
- `/posts`는 아카이브다: `type=all|original|ai` + 검색(`q`, FTS5) + 태그(`tag`) + 페이지네이션(`page`, `per_page`).
  - `q`가 있을 때: 관련도 우선(`bm25(posts_fts) ASC`) + 최신순 tie-break.
  - `q`가 없을 때: 최신순.
  - `type`은 `posts.origin(original|ai)` 기준이며, 생성 시 결정되고 변경되지 않는다.
- 상세 페이지(`/posts/[slug]`)는 `published`만 노출한다.
- `/write` 페이지는 클라이언트에서 `/api/health`를 호출해 API Key를 검증한다.
- 생성/수정 API는 `revalidatePath`로 홈/목록/상세/태그 캐시 갱신을 트리거한다.
- 상세 페이지 slug 조회는 decode-safe + `NFKC` 정규화를 적용한다.
- malformed 퍼센트 인코딩 slug(`%E0%A4%A`)는 Next.js 라우팅 레벨에서 `400`으로 처리된다.
- `POST /api/posts`는 토큰 기준 10회/60초, `POST /api/posts/bulk`는 3회/60초 레이트 리밋을 적용한다(프로세스 메모리 기준, 카운터 분리).
- `POST /api/inbox`는 토큰+IP 기준 10회/60초 레이트 리밋을 적용한다(프로세스 메모리 기준).
- `POST /api/posts`, `POST /api/posts/bulk`는 공통 JSON 구조화 로그를 출력하며 요청 본문 원문(`title`, `content`, `promptHint`)은 기록하지 않는다.

Sources: `src/app/api/health/route.ts`, `src/app/api/inbox/route.ts`, `src/app/api/inbox/[id]/route.ts`, `src/app/api/posts/route.ts`, `src/app/api/posts/bulk/route.ts`, `src/app/api/posts/check/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/app/api/uploads/route.ts`, `src/lib/auth.ts`, `src/lib/inbox-url.ts`, `src/lib/rate-limit.ts`, `src/lib/api-log.ts`, `src/app/page.tsx`, `src/app/posts/page.tsx`, `src/app/posts/[slug]/page.tsx`, `src/app/tags/[tag]/page.tsx`, `src/app/write/page.tsx`, `scripts/test-step-3.mjs`, `scripts/test-step-5.mjs`, `scripts/test-step-8.mjs`

## 4. Configuration and Deployment

### Environment variables

| Name                            | Required   | Used by                             | Description                                                                                      |
| ------------------------------- | ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `BLOG_API_KEY`                  | Yes (운영) | API routes, write auth, tests       | 보호 API 인증 키                                                                                 |
| `DATABASE_PATH`                 | No         | DB layer, tests                     | SQLite 파일 경로 오버라이드. 기본값은 `data/blog.db`, 운영 권장값은 `/var/lib/blog/data/blog.db` |
| `NEXT_PUBLIC_SITE_URL`          | No         | post metadata, Playwright webServer | 상세 페이지 canonical URL 생성 기준                                                              |
| `API_KEY`                       | No         | UI 테스트 헬퍼                      | 테스트 시 `BLOG_API_KEY` 대체 입력값                                                             |
| `RATE_LIMIT_MAX_REQUESTS`       | No         | `POST /api/posts`                   | 단건 글 생성 레이트 리밋 최대 요청 수(기본 10)                                                   |
| `RATE_LIMIT_WINDOW_MS`          | No         | `POST /api/posts`                   | 단건 글 생성 레이트 리밋 윈도우 ms(기본 60000)                                                   |
| `RATE_LIMIT_BULK_MAX_REQUESTS`  | No         | `POST /api/posts/bulk`              | 벌크 글 생성 레이트 리밋 최대 요청 수(기본 3)                                                    |
| `RATE_LIMIT_BULK_WINDOW_MS`     | No         | `POST /api/posts/bulk`              | 벌크 글 생성 레이트 리밋 윈도우 ms(기본 60000)                                                   |
| `INBOX_RATE_LIMIT_MAX_REQUESTS` | No         | `POST /api/inbox`                   | 수집 큐 인입 레이트 리밋 최대 요청 수(기본 10)                                                   |
| `INBOX_RATE_LIMIT_WINDOW_MS`    | No         | `POST /api/inbox`                   | 수집 큐 인입 레이트 리밋 윈도우 ms(기본 60000)                                                   |

### Build/deploy paths

- `next.config.ts`
  - `output: "standalone"`
  - `serverExternalPackages: ["better-sqlite3"]`
- standalone 산출물 핵심 경로:
  - `.next/standalone/server.js`
  - `.next/static` (런타임에 standalone 폴더로 복사 필요)
  - `public/` (런타임에 standalone 폴더로 복사 필요)
- Node 엔진 최소 버전: `>=20.9.0`

### Operational notes

- DB 초기화는 `getDb()` 최초 호출 시 자동 실행되며, 스키마/트리거/인덱스/FTS가 생성된다.
- SQLite PRAGMA: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`, `cache_size=-2000`
- 운영 배포는 영속 데이터 경로(`/var/lib/blog/data`, `/var/lib/blog/uploads`)를 사용하고, 각 릴리즈의 `data/uploads`는 해당 경로를 가리키는 심볼릭 링크로 구성한다.
- 헬스체크 엔드포인트: `GET /api/health`
- 업로드 파일은 `uploads/`에 저장되며 `.gitignore` 대상이다.
- 저장소에는 Oracle VM 배포용 GitHub Actions 워크플로우(`.github/workflows/deploy.yml`)가 포함된다.

### CI summary

- `verify` job: `npm ci` -> `lint` -> `format:check` -> `build` -> Next.js standalone 산출물 아티팩트 업로드 -> `test:step3`
- `ui-visual` job(verify 이후, viewport matrix): standalone 아티팩트 다운로드 -> Playwright Chromium 설치 -> `PLAYWRIGHT_SKIP_BUILD=1 npm run test:ui -- --project=<viewport>` -> 아티팩트 업로드
- `deploy` workflow: `push(main + paths filter)` 또는 `workflow_dispatch` -> `npm ci/build` -> standalone tar 패키징 -> SCP/SSH 배포 -> `systemctl` + `/api/health` 점검 -> 실패 시 롤백

Sources: `package.json`, `.env.example`, `next.config.ts`, `src/lib/db.ts`, `src/app/posts/[slug]/page.tsx`, `.gitignore`, `playwright.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `scripts/test-step-1.mjs`, `scripts/test-step-2.mjs`, `AGENTS.md`

## 5. Development and Testing

### Local run steps

1. `npm ci`
2. `.env.local`에 `BLOG_API_KEY` 설정 (`.env.example` 템플릿 사용 가능)
3. `npm run dev`
4. 필요 시 `npm run db:migrate`로 DB 경로/스키마 버전 확인

### Test strategy and commands

- 단계별 스크립트:
  - `npm run test:step1`: build/standalone/dev/env/.gitignore 기본 검증
  - `npm run test:step2`: DB 스키마/FTS/PRAGMA/제약조건 검증
  - `npm run test:step3`: API 인증/검증/중복/레이트리밋/업로드 검증
  - `npm run test:step4`: markdown 렌더링/XSS/Mermaid 제한 검증
  - `npm run test:step5`: 페이지 라우팅/SSR 출력/캐시 갱신/업로드 검증
    - 동적 포트 탐색 + 네트워크 오류 재시도로 `next dev` 충돌/일시적 fetch 실패를 완화한다.
  - `npm run test:step6`: CI/CD 게이트(클린 빌드, standalone 패키징/무결성, better-sqlite3 바인딩, 워크플로우 정책) 검증
  - `npm run test:step8`: bulk API 계약(최대 10건/원자성/중복/경합/레이트리밋), `aiModel`/`promptHint` 저장, 구조화 로그 키 검증
  - `npm run test:step9`: 관리자 워크스페이스(auth/notes/todos/schedules/uploads) 계약 검증
  - `npm run test:ui`: Playwright 시각 회귀 + 접근성 + 작성 E2E
- 로컬 반복: `npm run test:ui:fast` (viewport 1개만 실행)
- 전체 회귀: `npm run test:all` (`step1~5 + step8 + step9 + ui`)
  - 실행 오케스트레이션: `step1` -> (`step2` + `step4` 병렬) -> `step3` -> `step5` -> `step8` -> `step9` -> `ui`
  - 각 단계/그룹의 소요 시간과 총 소요 시간을 로그로 출력한다.
  - `test:all`은 Playwright의 `webServer` build를 스킵해(`PLAYWRIGHT_SKIP_BUILD=1`) build 중복을 방지한다.
- UI 테스트 특징:
  - 뷰포트 고정: `360`, `768`, `1440`
  - `toHaveScreenshot` 비교(애니메이션 비활성화)
  - `@axe-core/playwright`로 serious/critical 위반 차단
  - 고정 DB(`data/playwright-ui.db`) 및 시드 데이터 사용

### CI/CD workflow summary

- `ci.yml`: PR/지정 브랜치 push에서 검증 전용(`lint`, `format:check`, `build`, `test:step3`, `test:ui` viewport matrix)
- `deploy.yml`: `main` push + 경로 필터(`src/**`, `package*.json`, `next.config.*`) 또는 `workflow_dispatch`에서 배포 전용 실행
- 배포 워크플로우는 필수 Secrets(`BLOG_DOMAIN`, `VM_HOST`, `VM_USER`, `VM_SSH_KEY`) fail-fast 검증과 롤백 단계를 포함한다

Sources: `package.json`, `scripts/test-step-1.mjs`, `scripts/test-step-2.mjs`, `scripts/test-step-3.mjs`, `scripts/test-step-4.mjs`, `scripts/test-step-5.mjs`, `scripts/test-step-6.mjs`, `scripts/test-step-8.mjs`, `scripts/test-all.mjs`, `playwright.config.ts`, `tests/ui/visual-regression.spec.ts`, `tests/ui/accessibility.spec.ts`, `tests/ui/write-e2e.spec.ts`, `tests/ui/helpers.ts`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `docs/runbooks/deploy-log.md`

## 6. Extension Points

### Where to add new modules/features

- 신규 API: `src/app/api/<feature>/route.ts`에 라우트 추가, 인증/에러 포맷 공통화
- DB 스키마 확장: `src/lib/db.ts`의 스키마 SQL과 버전 상수(`CURRENT_SCHEMA_VERSION`) 갱신
- 마크다운 기능 확장: `src/lib/markdown.ts` 플러그인 체인/허용 스키마/언어 목록 확장
- UI 확장: `src/app/*` 페이지 + `src/components/*` 재사용 컴포넌트로 분리
- 테스트 확장: `scripts/test-step-*.mjs`(백엔드), `tests/ui/*.spec.ts`(UI) 동시 보강

### Common pitfalls and invariants

- API 에러 응답은 기본적으로 `{ error: { code, message, details } }` 형태를 유지한다.
- 예외: `POST /api/posts/bulk`는 bulk 계약에 따라 `{ created: [...], errors: [...], code? }` 형태를 사용한다.
- slug는 생성 시점에만 결정되고 PATCH에서 바꾸지 않는다(상세 URL 안정성)
- `source_url` 중복은 409로 처리하며 경합 상황에서도 단일 성공을 보장한다
- `POST /api/posts/bulk`는 최대 10건/단일 트랜잭션 정책을 유지해야 하며 부분 성공을 허용하지 않는다
- 글 생성/수정 시 홈/목록/상세/태그 경로 revalidate를 누락하지 않는다
- 레이트 리밋이 메모리 기반이므로 인스턴스 수평 확장 시 별도 저장소(예: Redis) 설계가 필요하다
- 글 생성 API 레이트 리밋은 단건(`10 req / 60s`)과 벌크(`3 req / 60s`)가 분리되어 있으며, 필요 시 각각의 환경변수로 조정할 수 있다
- 구조화 로그에는 요약값만 남기고 본문 원문(`title`, `content`, `promptHint`)을 기록하지 않는다
- `/uploads` URL 서빙 경로는 앱 외부 설정(Caddy 등)과 맞춰야 한다
- Shiki 언어 수 증가는 메모리 사용량 증가와 직결되므로 운영 제약(1GB RAM)을 고려해야 한다

Sources: `src/app/api/posts/route.ts`, `src/app/api/posts/bulk/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/app/api/uploads/route.ts`, `src/lib/api-log.ts`, `src/lib/db.ts`, `src/lib/markdown.ts`, `src/lib/rate-limit.ts`, `tests/ui/helpers.ts`, `AGENTS.md`
