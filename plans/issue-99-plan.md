# ISSUE #99 feat: 관리자 읽음 메타데이터 기반 미읽음 보기 및 정렬

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/99
- Issue 번호: 99
- 기준 브랜치: main
- 작업 브랜치: feat/issue-99-admin-read-importance-meta
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/feat/issue-99-admin-read-importance-meta
- 작성일: 2026-02-22

## 배경/문제
AI 수집 글이 증가하면서 최신순만으로는 관리자 재탐색 비용이 커지고 있다. 관리자 전용으로 글의 읽음 상태를 관리하고, 미읽음 기반 탐색 및 정렬 진입점을 제공해 운영 효율을 높여야 한다.

## 목표
- [x] 관리자만 글 상세에서 `읽음/읽지 않음`을 변경할 수 있다.
- [x] `/posts` 글 목록에서 미읽음 기준 탐색이 가능하고, 기본 정렬은 `안읽음 우선 -> 최신순`으로 동작한다.
- [x] 비로그인 공개 사용자 경험은 기존과 동일하게 유지한다.

## 범위
### 포함
- `posts` 메타데이터(`is_read`) 저장 스키마 및 마이그레이션 반영
- 관리자 API(`PATCH /api/admin/posts/[id]`)에 읽음 상태 업데이트 추가
- 글 상세(`/posts/[slug]`)의 관리자 전용 읽음/읽지 않음 컨트롤 추가
- `/posts`의 `read` 필터 확장 및 기본 정렬을 `안읽음 우선 -> 최신순`으로 조정
- `/posts` 글 목록 영역에 미읽음 진입 탭(`전체`/`미읽음`) 제공
- 관련 문서(`docs/codebase.md`, `plans/use-cases.md`) 동기화

### 제외
- 다중 관리자 계정/RBAC 확장
- 관리자 목록 카드에서 즉시 편집(인라인 토글) 기능
- 공개 사용자용 읽음 상태 노출

## 구현 단계
1. [x] 분석 및 재현 (`docs/codebase.md`의 `Sync Anchor (main)`/`Task Context Map` 확인 포함)
2. [x] 구현
   - [x] DB: `schema_versions` 신규 버전(예: v8) 마이그레이션 추가, `posts.is_read` 컬럼의 기본값/CHECK 제약/백필/인덱스 반영
   - [x] API: `PATCH /api/admin/posts/[id]` 입력 스키마에 `isRead`를 추가하고 응답 페이로드에 반영
   - [x] 상세 UI: `/posts/[slug]` 관리자 액션 영역에 읽음/읽지 않음 컨트롤을 추가하고 PATCH 성공 시 `router.refresh`로 반영
   - [x] 목록 UI/쿼리: `/posts`에 `read` 파라미터 정규화 및 기본값 정의, 기본 정렬(`is_read ASC`, `datetime(COALESCE(p.published_at, p.created_at)) DESC`, `p.id DESC`) 적용, 링크/페이지네이션 파라미터 유지
3. [x] 테스트
4. [x] 문서화/정리

## 영향 파일(예상)
- `src/lib/db.ts` (스키마/마이그레이션)
- `src/app/api/admin/posts/[id]/route.ts` (관리자 PATCH 확장)
- `src/lib/post-list.ts` (`read` 필터 및 기본 정렬 SQL 확장)
- `src/app/posts/page.tsx` (목록 필터 UI 및 쿼리스트링 처리)
- `src/app/posts/[slug]/page.tsx`, `src/app/posts/[slug]/PostAdminActionsClient.tsx` (상세 관리자 컨트롤)
- `scripts/test-step-2.mjs`, `scripts/test-step-9.mjs`, `scripts/test-step-10.mjs` (회귀 테스트 확장)
- `tests/ui/posts-archive.spec.ts`, `tests/ui/post-admin-actions.spec.ts` (Playwright 기능/시각 검증 확장)

## 리스크 및 확인 필요 사항
- DB 스키마 방식은 `posts` 컬럼 직접 추가(`is_read`)로 확정
- 기본 정렬 규칙(`is_read ASC -> 최신순`)의 SQL 우선순위 및 tie-breaker 일관성 확인 필요
- 기본 정렬 tie-breaker 확정값(`datetime(COALESCE(p.published_at, p.created_at)) DESC`, `id DESC`)을 구현 전 명시
- `/posts` 미읽음 진입 UI는 `전체`/`미읽음` 탭으로 확정

## 완료 기준 (Definition of Done)
- [x] DB: 마이그레이션 적용 후 `posts.is_read`가 모든 환경(신규/기존 DB)에서 일관되게 동작
- [x] API: `PATCH /api/admin/posts/[id]`에서 읽음 상태 수정이 성공/실패/권한/CSRF 케이스 모두 계약대로 동작
- [x] UI: `/posts/[slug]`에서 관리자 읽음/읽지 않음 변경이 가능하고 `/posts` 목록 필터/정렬에 즉시 반영
- [x] 테스트: 계획에 명시된 step/UI 테스트 추가 후 `npm run test:all` 통과
- [x] 문서: `docs/codebase.md`, `plans/use-cases.md`(UC/Traceability Matrix) 동기화 완료

## 롤백 기준
- 회귀 실패 시 `read` 신규 파라미터를 비활성화하고 기존 최신순 목록 동작을 기본값으로 유지한다.

## 검증 계획
- [x] 회귀: `npm run test:all`
- [x] Playwright 기능 테스트(권한/필터/정렬)
- [x] Playwright UI 스냅샷(`360/768/1440`) + 접근성(`@axe-core/playwright`)
- [x] `scripts/test-step-2.mjs`: `posts.is_read` 컬럼 존재, CHECK 제약, 백필, 마이그레이션 재실행(idempotency) 검증
- [x] `scripts/test-step-9.mjs`: `PATCH /api/admin/posts/[id]`의 `isRead` 성공·실패·CSRF 케이스 검증
- [x] `scripts/test-step-10.mjs`, `tests/ui/posts-archive.spec.ts`: `/posts`의 `read` 필터와 기본 정렬(`안읽음 우선 -> 최신순`) 검증
- [x] `tests/ui/post-admin-actions.spec.ts`: 상세 관리자 읽음/읽지 않음 컨트롤 동작 + 스냅샷(360/768/1440) + a11y 검증
- [x] 실패 시 수정 후 `npm run test:all` 전체 재실행
- [x] `plans/use-cases.md`에 신규/변경 UC 및 Traceability Matrix 동기화
