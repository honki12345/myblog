# ISSUE #39 구현 계획: 관리자 글 목록 페이지(/admin/posts)와 draft 필터 추가

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/39
- Issue 번호: 39
- 기준 브랜치: main
- 작업 브랜치: feat/admin-posts-list
- 상태: Draft
- 작성일: 2026-02-16

## 배경/문제
현재 관리자에서 `draft`로 저장한 글은 공개 화면(`/`, `/posts`)에 노출되지 않으며, 관리자 워크스페이스에도 별도 목록 페이지가 없어 재진입 경로가 약하다.

- 공개 화면은 `published`만 조회
- 관리자는 `/admin/write?id={id}`를 직접 알아야 초안 재편집이 쉬움
- 결과적으로 작성/검수 흐름이 끊김

## 목표
- [ ] 관리자 전용 글 목록 페이지(`/admin/posts`)를 제공한다.
- [ ] 상태 필터(`all`, `draft`, `published`)로 글을 분류 조회한다.
- [ ] 목록에서 바로 편집/공개 상세 이동이 가능하도록 한다.

## 비목표
- 다중 관리자 권한 모델 도입
- 대량 데이터용 서버 커서 기반 페이지네이션(이번 범위에서는 간단한 페이지네이션 또는 제한 조회)
- 공개 페이지 노출 정책 변경(`published`만 노출 유지)

## 구현 범위
### 포함
- `src/app/admin/posts/page.tsx` 신규 (관리자 세션 가드)
- `src/app/admin/posts/AdminPostsClient.tsx` 신규 (목록/필터/링크 UI)
- `GET /api/admin/posts` 활용 또는 필요한 최소 확장(필터 query 지원)
- 관리자 내비게이션에 `/admin/posts` 링크 추가
- 관련 UI 테스트 보강

### 제외
- 관리자 글 삭제 기능(필요 시 별도 이슈)
- 고급 검색/정렬 조건 추가(제목 검색, 태그 검색 등)

## 설계안
1. 라우트
- `/admin/posts` 접근 시 세션 없으면 `/admin/login?next=/admin/posts`로 리다이렉트

2. 데이터 조회
- 기본 정렬: `id DESC`
- 필터:
  - `all`: 전체
  - `draft`: `status='draft'`
  - `published`: `status='published'`

3. 화면 동작
- 각 행에 `수정` 버튼(`/admin/write?id={id}`)
- `published` 항목에는 `공개 보기` 링크(`/posts/{slug}`)
- `draft` 배지 명시

## 영향 파일(예상)
- `src/app/admin/posts/page.tsx` (new)
- `src/app/admin/posts/AdminPostsClient.tsx` (new)
- `src/app/layout.tsx` (관리자 링크 영역 조정 시)
- `src/app/api/admin/posts/route.ts` (필터 query 필요 시)
- `tests/ui/admin-workspace.spec.ts` (목록 진입/필터 스모크)
- `tests/ui/*` (필요 시 신규 스펙)
- `docs/codebase.md` (완료 후 문서 동기화)

## 테스트 계획
- [ ] 관리자 로그인 후 `/admin/posts` 접근 성공
- [ ] 비로그인 접근 시 로그인 리다이렉트
- [ ] 필터 `draft/published/all` 전환 시 목록 반영
- [ ] `수정` 클릭 시 `/admin/write?id={id}` 이동
- [ ] `published` 항목 `공개 보기` 링크 정상 이동
- [ ] `npm run test:step9` 통과
- [ ] `npm run test:all` 통과

## 완료 기준(DoD)
- [ ] 관리자 UI에서 초안 포함 글 목록을 확인할 수 있다.
- [ ] 공개 페이지 노출 정책은 기존대로 유지된다.
- [ ] 관리자 작성 흐름(초안 저장 -> 목록 -> 재편집)이 끊기지 않는다.
- [ ] 회귀 테스트(`test:step9`, `test:all`) 통과.
