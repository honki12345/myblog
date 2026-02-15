# Honki Codebase Documentation Pack

## 1. Project Overview

### Purpose

- 개인 블로그 서비스로, 공개 글 조회(홈/목록/태그/상세)와 인증 기반 글 작성/수정 API를 제공한다.
- 저장소 문서에는 "AI(크론잡) 수집 글 + 직접 작성 글" 목적이 명시되어 있다.

### Core capabilities

- Next.js App Router 기반 웹 페이지: `/`, `/posts`, `/posts/[slug]`, `/tags/[tag]`, `/write`
- SQLite(better-sqlite3) 기반 글/태그/출처 저장 및 FTS5 인덱스 유지
- API Key(Bearer) 기반 보호 API: 글 생성/수정, 글 단건 조회, 출처 중복 확인, 이미지 업로드
- 마크다운 렌더링 파이프라인: GFM + 수식(KaTeX) + 코드 하이라이트(Shiki) + sanitize + Mermaid placeholder
- Playwright 기반 시각 회귀 + 접근성 + 작성 E2E 테스트

### Non-goals / limitations (current implementation)

- 다중 사용자/계정 권한 모델은 없다. 단일 `BLOG_API_KEY`로 보호한다.
- 레이트 리밋은 프로세스 메모리(Map) 기반이라 멀티 인스턴스 간 공유되지 않는다.
- `DELETE /api/posts/...` 같은 삭제 API는 없다.
- 저장소 내에는 크론 스크래퍼/배포 스크립트(Caddy/systemd 설정 파일) 구현이 없다.
- 업로드 URL(`/uploads/...`)의 HTTP 서빙 매핑은 앱 코드에 없고 런타임/프록시 구성에 의존한다.

Sources: `AGENTS.md`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/posts/page.tsx`, `src/app/posts/[slug]/page.tsx`, `src/app/tags/[tag]/page.tsx`, `src/app/write/page.tsx`, `src/lib/db.ts`, `src/lib/markdown.ts`, `src/lib/rate-limit.ts`, `src/app/api/posts/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/app/api/posts/check/route.ts`, `src/app/api/uploads/route.ts`

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
- 작성 경로: `/write`에서 API Key 확인(`/api/health`) -> `POST /api/posts` 또는 `PATCH /api/posts/:id` -> DB 트랜잭션 -> `revalidatePath`로 홈/목록/상세/태그 갱신
- 렌더링 경로: 상세 페이지에서 `renderMarkdown()` 호출 -> Mermaid 블록은 base64 placeholder로 출력 -> 클라이언트에서 `mermaid` 동적 import 후 SVG 변환
- 업로드 경로: `/api/uploads`가 MIME + 매직바이트 검증 후 `uploads/YYYY/MM/uuid.ext` 저장 -> URL 반환

### External systems

- SQLite 파일 DB (`data/blog.db`, WAL 모드)
- 로컬 파일시스템 업로드 디렉터리(`uploads/`)
- 브라우저 `localStorage`(write 페이지의 API Key 보관)
- GitHub Actions CI (lint/format/build/API/UI tests)

Sources: `src/lib/db.ts`, `src/app/api/posts/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/lib/markdown.ts`, `src/components/PostContent.tsx`, `src/components/MermaidDiagram.tsx`, `src/app/write/page.tsx`, `src/app/api/uploads/route.ts`, `tests/ui/helpers.ts`, `.github/workflows/ci.yml`

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

| Method  | Path                       | Auth                                     | Behavior                                                                 | 주요 오류 코드                                                                          |
| ------- | -------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `GET`   | `/api/health`              | 선택적(Authorization 헤더가 있으면 검증) | DB 연결 확인. 인증 헤더 유효 시 `auth: "valid"` 포함                     | `UNAUTHORIZED`, `INTERNAL_ERROR`                                                        |
| `GET`   | `/api/posts`               | 없음                                     | 최신 100개 글 반환(현재 구현은 draft/published 모두 반환)                | -                                                                                       |
| `POST`  | `/api/posts`               | 필수                                     | 글 생성, slug 자동 생성, 태그/출처 저장, 경로 revalidate                 | `UNAUTHORIZED`, `INVALID_INPUT`, `DUPLICATE_SOURCE`, `RATE_LIMITED`, `INTERNAL_ERROR`   |
| `GET`   | `/api/posts/check?url=...` | 필수                                     | `source_url` 중복 여부 확인                                              | `UNAUTHORIZED`, `INVALID_INPUT`, `INTERNAL_ERROR`                                       |
| `GET`   | `/api/posts/:id`           | 필수                                     | 글 단건 + 태그 배열 반환                                                 | `UNAUTHORIZED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`                          |
| `PATCH` | `/api/posts/:id`           | 필수                                     | 제목/본문/상태/태그 부분 수정, `published_at` 전이 처리, 경로 revalidate | `UNAUTHORIZED`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`                          |
| `POST`  | `/api/uploads`             | 필수                                     | 이미지 업로드(최대 5MB, png/jpeg/webp/gif) 후 URL 반환                   | `UNAUTHORIZED`, `INVALID_INPUT`, `FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`, `INTERNAL_ERROR` |

### Input/output contracts (selected)

- `POST /api/posts`
  - 입력: `title(<=200)`, `content(<=100000)`, `status(draft|published)`, `tags(<=10, 각 <=30)`, `sourceUrl(url, <=2048, optional)`
  - 출력: `201 { id, slug }`
  - 제한: 같은 `sourceUrl`은 409, 같은 제목은 slug suffix(`-2`, `-3`...) 부여
- `PATCH /api/posts/:id`
  - 입력: `title|content|status|tags` 중 최소 1개 필요
  - 동작: `published_at`은 처음 `published` 될 때만 설정되고 이후 재발행에서는 유지
- `POST /api/uploads`
  - 파일 필드명: `file`
  - 저장 위치: `uploads/<YYYY>/<MM>/<uuid>.<ext>`
  - 출력: `201 { url: "/uploads/..." }`

### Auth / permissions and cache behavior

- 공개 페이지(`/`, `/posts`, `/posts/[slug]`, `/tags/[tag]`)는 `status='published'`만 노출한다.
- `/write` 페이지는 클라이언트에서 `/api/health`를 호출해 API Key를 검증한다.
- 생성/수정 API는 `revalidatePath`로 홈/목록/상세/태그 캐시 갱신을 트리거한다.
- `POST /api/posts`는 토큰 기준 10회/60초 레이트 리밋을 적용한다(프로세스 메모리 기준).

Sources: `src/app/api/health/route.ts`, `src/app/api/posts/route.ts`, `src/app/api/posts/check/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/app/api/uploads/route.ts`, `src/lib/auth.ts`, `src/lib/rate-limit.ts`, `src/app/page.tsx`, `src/app/posts/page.tsx`, `src/app/posts/[slug]/page.tsx`, `src/app/tags/[tag]/page.tsx`, `src/app/write/page.tsx`, `scripts/test-step-3.mjs`, `scripts/test-step-5.mjs`

## 4. Configuration and Deployment

### Environment variables

| Name                   | Required   | Used by                             | Description                                          |
| ---------------------- | ---------- | ----------------------------------- | ---------------------------------------------------- |
| `BLOG_API_KEY`         | Yes (운영) | API routes, write auth, tests       | 보호 API 인증 키                                     |
| `DATABASE_PATH`        | No         | DB layer, tests                     | SQLite 파일 경로 오버라이드. 기본값은 `data/blog.db` |
| `NEXT_PUBLIC_SITE_URL` | No         | post metadata, Playwright webServer | 상세 페이지 canonical URL 생성 기준                  |
| `API_KEY`              | No         | UI 테스트 헬퍼                      | 테스트 시 `BLOG_API_KEY` 대체 입력값                 |

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
- 헬스체크 엔드포인트: `GET /api/health`
- 업로드 파일은 `uploads/`에 저장되며 `.gitignore` 대상이다.
- 저장소에는 Caddy/systemd/Oracle 배포 자동화 파일이 없고, CI는 검증 파이프라인만 제공한다.

### CI summary

- `verify` job: `npm ci` -> `lint` -> `format:check` -> `build` -> `test:step3`
- `ui-visual` job(verify 이후): Playwright Chromium 설치 -> `npm run test:ui` -> 아티팩트 업로드

Sources: `package.json`, `.env.example`, `next.config.ts`, `src/lib/db.ts`, `src/app/posts/[slug]/page.tsx`, `.gitignore`, `playwright.config.ts`, `.github/workflows/ci.yml`, `scripts/test-step-1.mjs`, `scripts/test-step-2.mjs`, `AGENTS.md`

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
  - `npm run test:ui`: Playwright 시각 회귀 + 접근성 + 작성 E2E
- 전체 회귀: `npm run test:all` (`step1~5 + ui`)
- UI 테스트 특징:
  - 뷰포트 고정: `360`, `768`, `1440`
  - `toHaveScreenshot` 비교(애니메이션 비활성화)
  - `@axe-core/playwright`로 serious/critical 위반 차단
  - 고정 DB(`data/playwright-ui.db`) 및 시드 데이터 사용

### CI/CD workflow summary

- PR/지정 브랜치 push에서 자동 검증
- 현재 CI는 `test:all` 전체 대신 `test:step3` + `test:ui` 조합으로 실행

Sources: `package.json`, `scripts/test-step-1.mjs`, `scripts/test-step-2.mjs`, `scripts/test-step-3.mjs`, `scripts/test-step-4.mjs`, `scripts/test-step-5.mjs`, `scripts/test-all.mjs`, `playwright.config.ts`, `tests/ui/visual-regression.spec.ts`, `tests/ui/accessibility.spec.ts`, `tests/ui/write-e2e.spec.ts`, `tests/ui/helpers.ts`, `.github/workflows/ci.yml`

## 6. Extension Points

### Where to add new modules/features

- 신규 API: `src/app/api/<feature>/route.ts`에 라우트 추가, 인증/에러 포맷 공통화
- DB 스키마 확장: `src/lib/db.ts`의 스키마 SQL과 버전 상수(`CURRENT_SCHEMA_VERSION`) 갱신
- 마크다운 기능 확장: `src/lib/markdown.ts` 플러그인 체인/허용 스키마/언어 목록 확장
- UI 확장: `src/app/*` 페이지 + `src/components/*` 재사용 컴포넌트로 분리
- 테스트 확장: `scripts/test-step-*.mjs`(백엔드), `tests/ui/*.spec.ts`(UI) 동시 보강

### Common pitfalls and invariants

- API 에러 응답은 `{ error: { code, message, details } }` 형태를 유지
- slug는 생성 시점에만 결정되고 PATCH에서 바꾸지 않는다(상세 URL 안정성)
- `source_url` 중복은 409로 처리하며 경합 상황에서도 단일 성공을 보장한다
- 글 생성/수정 시 홈/목록/상세/태그 경로 revalidate를 누락하지 않는다
- 레이트 리밋이 메모리 기반이므로 인스턴스 수평 확장 시 별도 저장소(예: Redis) 설계가 필요하다
- `/uploads` URL 서빙 경로는 앱 외부 설정(Caddy 등)과 맞춰야 한다
- Shiki 언어 수 증가는 메모리 사용량 증가와 직결되므로 운영 제약(1GB RAM)을 고려해야 한다

Sources: `src/app/api/posts/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/app/api/uploads/route.ts`, `src/lib/db.ts`, `src/lib/markdown.ts`, `src/lib/rate-limit.ts`, `tests/ui/helpers.ts`, `AGENTS.md`
