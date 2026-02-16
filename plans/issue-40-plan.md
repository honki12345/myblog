# ISSUE #40 feat: 관리자 로그인 시 글 목록에 draft 노출 분기

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/40
- Issue 번호: 40
- 기준 브랜치: main
- 작업 브랜치: issue-40-feat-draft
- Worktree 경로: .../.worktrees/issue-40-feat-draft
- 작성일: 2026-02-16

## 배경/문제
공개 글 목록은 현재 `published`만 노출되므로, 관리자 로그인 상태에서도 작성 중인 `draft`를 같은 목록 맥락에서 확인할 수 없다. 
요구사항은 관리자 로그인 상태일 때만 글 목록 조회 조건을 확장해 `draft`와 `published`를 함께 노출하고, 비로그인/일반 사용자에게는 기존처럼 `published`만 유지하는 것이다.

## 목표
- [x] 관리자 로그인 상태에서 글 목록에 `draft`와 `published`를 함께 노출한다.
- [x] 비로그인/일반 사용자 상태에서는 글 목록에 `published`만 노출한다.

## 범위
### 포함
- 글 목록 조회 로직의 인증 상태 기반 상태(status) 필터 분기
- 관리자/비관리자 시나리오 검증 테스트 보강
- 공개 API `GET /api/posts` 응답에서 `draft` 미노출 처리 (`published`만 반환)

### 제외
- 관리자 전용 목록 페이지(`/admin/posts`) 신설 및 UI 필터 기능(#39 범위)
- 글 작성/수정 API의 인증 정책 변경

## 구현 단계
1. [x] 분석 및 재현
2. [x] 구현
3. [x] 테스트
4. [x] 문서화/정리

### 세부 작업
- [x] 관리자 판별: Server Component에서 `getAdminSessionFromServerCookies()`로 `isAdmin` 도출 (`admin_session` 쿠키 기반 세션만 신뢰)
- [x] 적용 대상(페이지): `/`, `/posts`, `/tags/[tag]` 목록 쿼리의 `status` 조건을 `isAdmin`에 따라 분기
  - 비로그인/일반 사용자: `published`만 노출
  - 관리자 로그인: `draft` + `published` 노출
- [x] Draft 카드 링크: 목록에서 draft를 클릭하면 404가 나지 않도록 `/admin/write?id={postId}`로 이동하도록 링크 분기
  - published는 기존처럼 `/posts/{slug}` 유지
  - (선택) draft 배지/상태 표기 추가
- [x] 공개 API 정책: `GET /api/posts`는 `published`만 반환한다. draft는 관리자 전용 `/api/admin/posts`에서만 조회한다.

## 리스크 및 확인 필요 사항
- 관리자 판별 로직이 라우트별로 중복돼 있으면 분기 누락 또는 정책 불일치가 생길 수 있음
- 목록 조회 경로(페이지/API/검색)가 복수일 경우 모두 동일 정책을 적용해야 함
- 쿠키 기반(관리자 세션) 분기를 추가하면 페이지 캐시/렌더링 모드가 달라질 수 있으므로, 비로그인 경로에서 draft가 절대 노출되지 않는지 테스트로 고정해야 함

## 영향 파일
- `src/app/page.tsx`
- `src/app/posts/page.tsx`
- `src/app/tags/[tag]/page.tsx`
- `src/app/api/posts/route.ts`
- `src/components/PostCard.tsx`
- `tests/ui/draft-visibility.spec.ts` (신규)
- `docs/codebase.md`

## 완료 기준(DoD)
- [x] 비로그인/일반 사용자: `/`, `/posts`, `/tags/[tag]`에서 `draft`가 노출되지 않는다.
- [x] 관리자 로그인: `/`, `/posts`, `/tags/[tag]`에서 `draft` + `published`가 노출된다.
- [x] 목록에서 draft 클릭 시 `/admin/write?id={id}`로 이동한다. (published는 `/posts/{slug}` 유지)
- [x] `GET /api/posts`는 `published`만 반환한다. (draft는 포함되지 않는다)
- [x] `npm run test:ui` 통과
- [x] `npm run test:all` 통과

## 검증 계획
- [x] 단위/통합 테스트
- [x] Playwright 기반 시나리오 검증 (관리자/비로그인 목록 노출 분기)
  - [x] 신규 스펙: `tests/ui/draft-visibility.spec.ts`
  - [x] 비로그인 시나리오
    - [x] `/posts`에서 `draft` 미노출, `published` 노출
  - [x] 관리자 로그인 시나리오
    - [x] `/posts`에서 `draft` + `published` 노출
    - [x] draft 카드 클릭 → `/admin/write?id={id}` 이동 (published는 `/posts/{slug}` 유지)
  - [x] (선택) `/` 및 `/tags/[tag]`에도 동일 정책 적용/검증
- [x] API 시나리오
  - [x] `GET /api/posts` 응답에서 `draft`가 포함되지 않음
- [x] 통과 기준: `npm run test:ui` 및 `npm run test:all` 통과
- [x] PR 전 `npm run test:all` 통과

## 문서화/정리
- [x] `docs/codebase.md`의 정책 설명을 이번 변경과 정합되게 업데이트
  - [x] `GET /api/posts`는 `published`만 반환
  - [x] 공개 페이지(`/`, `/posts`, `/tags/[tag]`)는 기본 `published`만, 관리자 세션에서만 `draft` + `published`
  - [x] 목록에서 draft 편집 이동 경로: `/admin/write?id={id}`
