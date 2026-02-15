# Issue #18 수정 계획서

> 대상 이슈: https://github.com/honki12345/myblog/issues/18  
> 브랜치: `fix/post-detail-404`  
> 작성일: 2026-02-15  
> 연계 문서: `AGENTS.md`, `plans/implementation-plan.md`, `plans/step5-plan.md`

## 1. 문제 요약

`/posts/[slug]` 상세 페이지 404가 다음 2가지 케이스에서 발생한다.

1. `draft` 저장 직후에도 상세 페이지(`/posts/{slug}`)로 이동해 404가 발생한다.
2. `published` 글이어도 한글(비ASCII) slug 접근 시 404가 발생한다.

코드 확인 기준 주요 위치:
- `src/app/write/page.tsx`
- `src/app/posts/[slug]/page.tsx`
- `src/lib/slug.ts`
- `scripts/test-step-5.mjs`
- `tests/ui/write-e2e.spec.ts`

## 2. 목표와 비목표

### 목표

- 저장 후 이동을 글 상태(`draft`/`published`)에 맞게 분기한다.
- 한글 slug 상세 조회가 plain URL, percent-encoded URL 모두에서 200을 반환하도록 수정한다.
- 동일 회귀를 자동화 테스트로 고정한다.

### 비목표

- slug 생성 규칙 자체 변경(기존 slug 재작성/마이그레이션)은 이번 이슈 범위에서 제외한다.
- 관리자 인증 구조 변경(`API Key` -> 세션 인증 전환)은 이번 이슈 범위에서 제외한다.

## 3. 원인 가설 및 검증 방식

### A. draft 저장 후 리다이렉트 404

- 현재 `write` 저장 성공 후 상태와 무관하게 ``router.push(`/posts/${slug}`)``를 실행한다.
- 상세 페이지는 `status='published'`만 조회하므로 draft는 정상적으로 notFound로 처리된다.

검증:
- `draft` 저장 직후 URL/응답을 확인해 상세 이동 대신 편집 화면 유지(또는 `/write?id={id}` 이동)인지 검증한다.

### B. published + 한글 slug 404

- 상세 라우트에서 params slug를 그대로 DB 조회(`WHERE p.slug = ?`)에 사용한다.
- 한글 slug의 인코딩/디코딩 또는 Unicode normalization 불일치로 조회 키가 어긋날 가능성이 높다.

검증:
- 라우트 파라미터 원문, decode 결과, normalize 결과를 비교해 DB 저장 slug와 일치 여부를 확인한다.
- plain 한글 경로(`/posts/최초-글-2`)와 encoded 경로(`/posts/%EC%B5%9C...`) 모두 테스트한다.

## 4. 구현 범위

### 4-1. 저장 후 이동 정책 수정 (`src/app/write/page.tsx`)

- 저장 응답 계약을 명시한다.
  - 현재 API 계약 유지 시 `POST /api/posts` 응답은 `id`, `slug`를 파싱하고, 이동 분기는 요청 payload의 `status`로 결정한다.
  - API 계약을 확장해 응답에 `status`를 추가할 경우, `src/app/api/posts/route.ts`와 `scripts/test-step-3.mjs`를 함께 수정한다.
- 정책 확정값: `draft` 저장 성공 시 `/write?id={id}`로 이동한다. (현재 URL 유지 방식 미채택)
- 이동 규칙:
  - `published`: `/posts/{slug}` 이동
  - `draft`: `/write?id={id}` 이동(작성 화면 유지 의미)
- `id` 누락 시에는 안전하게 현재 화면 유지 + 오류 메시지 처리.
- 수정(PATCH) 시에도 동일 정책을 적용해 상태 변경 흐름을 일관화한다.

### 4-2. slug 조회 정규화 도입 (`src/app/posts/[slug]/page.tsx`, `src/lib/slug.ts`)

- slug 조회 전처리 유틸을 공통화한다. (예: decode-safe + `normalize("NFKC")`)
  - 퍼센트 인코딩이 포함된 경우에만 `decodeURIComponent`를 시도한다.
  - `decodeURIComponent`에서 `URIError`가 발생해도 앱 예외(500)가 나지 않도록 안전하게 처리한다.
  - malformed 퍼센트 인코딩은 Next.js 기본 동작(400)을 따른다.
- 상세 조회는 전처리된 slug를 기준으로 DB 조회한다.
- metadata 생성(`generateMetadata`)과 본문 렌더링(`PostDetailPage`) 모두 동일 전처리 경로를 사용한다.
- 필요 시 canonical URL은 DB에 저장된 `post.slug`를 기준으로 유지한다.

### 4-3. 회귀 테스트 추가

### 통합 스크립트 (`scripts/test-step-5.mjs`)

- `published` 한글 제목 글 생성 후 상세 접근 200 검증:
  - plain 한글 URL
  - percent-encoded URL
- `draft` 저장 글은 상세 404 유지 검증(권한/정책 회귀 방지).

### Playwright E2E (`tests/ui/write-e2e.spec.ts`)

- `draft` 저장 후 URL이 `/write?id={id}`로 유지/이동되고, 상세(`/posts/{slug}`)로 리다이렉트되지 않음을 검증한다.
- 한글 제목 `published` 저장 후 URL이 `/posts/{slug}`로 이동하고, 상세 페이지 제목이 렌더링됨을 검증한다.

### Playwright 시각/접근성 회귀 (`tests/ui/visual-regression.spec.ts`, `tests/ui/accessibility.spec.ts`)

- 기존 UI 정책(`toHaveScreenshot`, 뷰포트 `360/768/1440`)을 유지한 스모크 회귀로 운영한다.
- 이슈 #18 핵심 회귀(한글 slug 상세, draft 저장 후 이동)는 `scripts/test-step-5.mjs`, `tests/ui/write-e2e.spec.ts`에서 우선 보장한다.
- 접근성 검사(`@axe-core/playwright`)에서 신규 오류가 발생하지 않음을 확인한다.

## 5. 수용 기준 (Acceptance Criteria)

- `draft` 저장 후 404 페이지로 이동하지 않는다.
- `published` 한글 slug 상세 페이지가 200으로 열린다.
- plain/encoded 한글 slug 접근 모두 동일 결과를 반환한다.
- 잘못된 퍼센트 인코딩 slug 접근 시 500이 아닌 400(프레임워크 기본 동작)으로 안전 처리된다.
- 기존 영문 slug 상세 동작이 유지된다.
- 아래 테스트가 모두 통과한다.
  - `npm run test:step5`
  - `npm run test:ui`
  - `npm run test:all`

## 6. 리스크와 대응

- 리스크: slug 전처리 로직이 과도하면 기존 slug 해석을 깨뜨릴 수 있다.
- 대응: 전처리는 decode-safe + normalization 최소 범위로 제한하고, 기존 영문 slug 케이스를 회귀 테스트에 포함한다.

- 리스크: `draft` 저장 후 라우팅 변경이 사용자 기대와 다를 수 있다.
- 대응: 정책을 문서화하고, 편집 상태 유지 동작을 E2E로 고정한다.

- 리스크: 회귀 테스트 실패 상태에서 변경을 병합하면 동일 장애가 재발할 수 있다.
- 대응: `npm run test:step5`, `npm run test:ui` 실패 시 수정 후 재실행하고, 최종적으로 `npm run test:all` 통과를 확인한다.

## 7. 작업 순서

1. `write` 저장 응답 파싱 및 상태별 리다이렉트 분기 구현
2. slug 조회 전처리 유틸 구현 및 상세 페이지 적용
3. `scripts/test-step-5.mjs`에 한글 slug/ draft 시나리오 추가 후 `npm run test:step5` 선검증
4. `tests/ui/write-e2e.spec.ts`에 라우팅 회귀 시나리오 추가 후 `npm run test:ui` 검증
5. 최종 회귀로 `npm run test:all`을 실행해 게이트 통과 확인
