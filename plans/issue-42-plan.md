# ISSUE #42 feat: 글 상세에서 관리자 수정/삭제 버튼 노출

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/42
- Issue 번호: 42
- 기준 브랜치: main (`myblog/main`)
- 작업 브랜치: issue-42-feat-post-admin-actions
- Worktree 경로: .../.worktrees/issue-42-feat-post-admin-actions
- 작성일: 2026-02-16

## 배경/문제
공개 글 상세 페이지(`/posts/[slug]`)에서 관리자(세션 쿠키 로그인)도 글을 바로 수정/삭제할 수 있는 액션이 없다. 현재는 `/admin/write?id=...`로 수동 이동해야 해서 관리 플로우가 끊긴다.

## 목표
- [x] 관리자 로그인(세션+쿠키) 상태에서만 글 상세 페이지에 `수정`/`삭제` 버튼이 노출된다.
- [x] `수정`은 `/admin/write?id=<postId>`로 이동한다.
- [x] `삭제`는 CSRF 보호가 적용된 관리자 API로 삭제되고, 삭제 후 목록으로 이동한다.
- [x] 회귀 방지를 위해 Playwright 테스트를 추가하고 `npm run test:all`을 통과한다.

## 범위
### 포함
- `/posts/[slug]` 페이지에서 서버 기준으로 관리자 세션 여부 확인 후 액션 UI 조건부 렌더링
  - 참고 후보: `getAdminSessionFromServerCookies()` 활용
- `수정` 링크 추가: `/admin/write?id=<postId>`
- `삭제` 버튼 추가
  - confirm 후 `DELETE /api/admin/posts/<id>` 호출 (CSRF 필요)
  - 성공 시 `/posts`로 이동
  - 실패 시 사용자에게 오류 노출
- 관리자 글 삭제 API 구현
  - `src/app/api/admin/posts/[id]/route.ts`에 `DELETE` 추가
  - 삭제는 hard delete(행 삭제). `sources`는 유지하고 `post_id = NULL`로 분리한 뒤 `posts` 삭제 (source_url 중복 차단 유지)
  - 삭제 후 관련 경로 `revalidatePath` 처리

### 제외
- 관리자 인증 방식/세션 구조 전면 변경
- 글 목록/상세 UI 리디자인
- soft delete 도입(예: `deleted_at` 추가) 등 DB 스키마/정책 변경 (삭제는 현행 스키마 기준 hard delete로 처리)

## 구현 단계
1. [x] 분석 및 재현
2. [x] 구현
3. [x] 테스트
4. [x] 문서화/정리

### 세부 작업
- [x] `src/app/posts/[slug]/page.tsx`에서 관리자 세션을 서버에서 확인하고, 관리 액션 UI를 조건부 렌더링
- [x] 관리 액션 UI 컴포넌트 분리(필요 시 `use client`로 삭제 버튼 동작 처리, 삭제 API 호출은 `adminFetch()` 사용)
- [x] `src/app/api/admin/posts/[id]/route.ts`에 `DELETE` 구현
  - [x] `requireAdminSessionWithCsrf()`로 관리자 세션 + CSRF 검증(`admin_csrf` 쿠키 + `x-csrf-token` 헤더)
  - [x] DB 삭제 + `revalidatePath` 적용 범위 확정(`/`, `/posts`, `/posts/${slug}`, `/tags/<tag>` 등). 기본은 구체 URL(`/posts/${slug}`)로 무효화하고, 패턴(`/posts/[slug]`)을 쓰면 `revalidatePath('/posts/[slug]', 'page')`처럼 `type`을 명시
  - [x] 성공 응답: `200 { ok: true }`
- [x] 실패 UX: 네트워크/API 오류 시 사용자에게 메시지 노출

## 리스크 및 확인 필요 사항
- CSRF 토큰 전달 방식: `admin_csrf` 쿠키 + `x-csrf-token` 헤더(서명된 Double Submit) 사용. 클라이언트 호출은 `adminFetch()`(`src/lib/admin-client.ts`)로 통일
- `posts` 삭제 시 `sources.post_id` FK 때문에 삭제 순서/처리가 필요 (예: `sources.post_id = NULL` 처리 후 `DELETE FROM posts`)
- `/posts/[slug]`에서 서버 쿠키로 관리자 세션을 읽으면 캐시/정적화에 영향이 있을 수 있음 (문제 시 관리 액션 UI만 클라이언트 게이트로 전환)
- 삭제 후 라우팅 대상(`/posts` vs `/`)과 캐시 무효화 범위가 누락되면 “삭제됐는데 보이는” 상태가 발생할 수 있음
- `notFound()` 처리/권한 처리와 액션 UI 노출 조건이 불일치하면 정보 노출 또는 UX 혼란이 생길 수 있음

## 검증 계획
- [x] Playwright: 비로그인 상태에서 글 상세에 `수정/삭제` 버튼이 보이지 않는다.
- [x] Playwright: 로그인 상태에서 `수정` 링크(`/admin/write?id=<postId>`)가 노출된다.
- [x] 테스트 데이터: Playwright에서 posts seed 후(예: 직접 insert + revalidate 트리거) 글 상세 페이지가 안정적으로 로드되도록 준비한다.
- [x] Playwright: `삭제` 클릭 → confirm → 삭제 API 호출 → 목록으로 이동, 이후 해당 글 상세가 404(또는 목록에서 미노출)임을 검증
- [x] Playwright(API): 로그인 상태에서 CSRF 헤더 없이 `DELETE /api/admin/posts/<id>` 호출 시 `403 CSRF_FAILED`
- [x] Playwright UI 기준: `toHaveScreenshot` + 뷰포트 `360/768/1440` 포함(필요 시 `@axe-core/playwright` 접근성 검사 병행)
- [x] 최종: `npm run test:all` 통과 (`BLOG_API_KEY=your-api-key-here npm run test:all`)
