# ISSUE #106 feat: 포스트 관리자 전용 전환 및 홈 위키 뷰 기본화

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/106
- Issue 번호: 106
- 기준 브랜치: main
- 작업 브랜치: issue-106-feat
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-106-feat
- 작성일: 2026-02-21
- 문서 위치 정합성: 본 초안은 `docs/plan/ISSUE_106_feat.md`에 있으나 최종 계획 문서는 `plans/issue-106-plan.md`로 이관/유지한다.

## 배경/문제
현재 비관리자도 `/`, `/posts`, `/posts/[slug]`, `/tags*`에서 공개 포스트를 조회할 수 있다. 정책을 관리자 전용으로 전환하며, 홈을 위키 루트 탐색 중심으로 개편하고 태그 진입을 위키 경로로 흡수해야 한다.

## 목표
- [ ] 비관리자 세션에서 포스트 목록/상세/관련 진입점 접근을 차단한다.
- [ ] 홈(`/`)을 포스트 피드 중심에서 위키 루트 탐색 중심 화면으로 전환한다.
- [ ] 상단 내비게이션의 글목록 탭을 관리자 세션에서만 노출한다.
- [ ] 태그 라우트(`/tags`, `/tags/[tag]`)를 위키 라우트로 통합하는 정책을 적용한다.
- [ ] Playwright 회귀 테스트와 문서(use-cases/codebase) 동기화를 완료한다.

## 범위
### 포함
- 페이지 라우트 차단 정책 적용(기본안: 비관리자 `/admin/login?next=...` 리다이렉트)
- API 차단 정책 적용(기본안: 401)
- 홈 UI 정보구조 개편(위키 탐색 중심)
- 내비게이션 조건부 렌더링(관리자 세션 전용)
- 태그 -> 위키 리다이렉트 및 canonical/호환 정책 정리
- 관련 Playwright/기능 테스트 및 문서 갱신

### 제외
- 다중 관리자 권한 체계(RBAC) 도입
- 위키 데이터 모델의 대규모 구조 변경
- 태그 데이터 자체의 대규모 정제/마이그레이션

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리
5. [ ] 기능/테스트 변경분에 대한 `plans/use-cases.md` 유스케이스/Traceability Matrix 동기화
6. [ ] 라우트/가시성 정책 변경분에 대한 `docs/codebase.md`(Architecture/API/Task Context Map) 동기화

## 구현 상세 (파일 단위)
- 페이지 접근 제어
  - [ ] `src/app/page.tsx`: 비관리자 접근 차단(기본안: `/admin/login?next=/`)
  - [ ] `src/app/posts/page.tsx`: 비관리자 접근 차단 + next 파라미터 유지
  - [ ] `src/app/posts/[slug]/page.tsx`: 비관리자 접근 차단 + slug 경로 next 유지
  - [ ] `src/app/tags/page.tsx`, `src/app/tags/[tag]/page.tsx`: 위키 라우트 리다이렉트 또는 폴백 정책 적용
- 내비게이션/링크 정리
  - [ ] `src/app/layout.tsx`: 글목록 탭 관리자 세션 전용 렌더링
  - [ ] `src/components/TagList.tsx`: 태그 링크를 위키 경로로 전환
  - [ ] `src/components/SearchBar.tsx`: `/posts` 의존 링크/폼 정책 정리(필요 시 관리자 로그인 경유)
  - [ ] `src/app/posts/[slug]/PostAdminActionsClient.tsx`: 삭제 후 이동 경로(`/posts`) 정책 정합성 반영
- 캐시 무효화/연계 라우트 정리
  - [ ] `src/app/api/posts/route.ts`
  - [ ] `src/app/api/posts/bulk/route.ts`
  - [ ] `src/app/api/posts/[id]/route.ts`
  - [ ] `src/app/api/admin/posts/route.ts`
  - [ ] `src/app/api/admin/posts/[id]/route.ts`
  - [ ] `revalidatePath` 대상에서 `/tags*` 제거 또는 `/wiki*` 대체 반영
- 테스트 영향 파일
  - [ ] `tests/ui/draft-visibility.spec.ts`
  - [ ] `tests/ui/write-link-auth.spec.ts`
  - [ ] `tests/ui/tags-index.spec.ts`
  - [ ] `tests/ui/posts-archive.spec.ts`
  - [ ] `tests/ui/posts-search-autocomplete.spec.ts`
  - [ ] `tests/ui/wiki-view.spec.ts`
  - [ ] `scripts/test-step-10.mjs`

## 리스크 및 확인 필요 사항
- 태그 문자열을 위키 경로 규칙으로 정규화할 때 기존 URL 호환성이 깨질 수 있음
- 로그인 리다이렉트(`next`) 적용 범위가 페이지/내부 링크에서 불일치할 수 있음
- 홈 화면 개편 시 기존 SEO 시그널(메타/내부링크) 영향 검토 필요
- 확정 정책(태그 -> 위키 변환 실패 시 404) 적용 후 사용자 오류 유입률/로그 모니터링 필요

## 결정 필요 항목 (Decision Log)
| 항목 | 현재 상태 | 결정 기한 | 적용 파일/영역 | 비고 |
| --- | --- | --- | --- | --- |
| 비관리자 API 401 적용 범위 (`/api/posts` GET, `/api/posts/suggest`) | 확정 (둘 다 401) | 완료 | `src/app/api/posts/route.ts`, `src/app/api/posts/suggest/route.ts`, 관련 테스트 | 페이지 차단 정책과 API 정책을 동일하게 맞춤 |
| 태그 -> 위키 경로 변환 실패 처리 | 확정 (404) | 완료 | `src/app/tags/page.tsx`, `src/app/tags/[tag]/page.tsx`, `src/lib/comment-tags.ts` | 변환 실패를 명확히 노출 |
| `/posts` 경로 유지 여부(관리자 전용 유지 vs `/admin/write` 중심 축소) | 확정 (관리자 전용 유지) | 완료 | `src/app/layout.tsx`, `src/components/SearchBar.tsx`, `src/app/posts/[slug]/PostAdminActionsClient.tsx` | 기존 검색/목록 자산 재사용 |

## 착수 게이트
- [x] Decision Log 3개 항목을 모두 확정한다.
- [ ] 확정된 정책을 기준으로 영향 파일/테스트 수정 범위를 다시 동결한다.
- [ ] 비관리자 리다이렉트 루프/오탐(관리자도 차단) 위험에 대한 사전 점검 시나리오를 준비한다.

## 완료 기준 (Definition of Done)
- [ ] 페이지 정책: 비관리자 `/`, `/posts`, `/posts/[slug]`, `/tags*` 접근 차단이 의도대로 동작한다.
- [ ] 태그 정책: `/tags`, `/tags/[tag]`가 확정된 규칙대로 `/wiki*`에 연결된다.
- [ ] API 정책: Decision Log에서 확정한 `/api/posts`, `/api/posts/suggest` 비관리자 계약이 구현/테스트와 일치한다.
- [ ] 테스트: 관련 Playwright 및 스크립트 테스트가 통과하고 최종 `npm run test:all`이 성공한다.
- [ ] 문서: `plans/use-cases.md`, `docs/codebase.md`에 정책/테스트 변경분이 반영된다.

## 검증 계획
- [ ] 단위/통합 테스트: 비관리자 페이지 접근 차단(리다이렉트), API 차단(401), 관리자 세션 접근 허용 검증
- [ ] 태그 라우트 통합 테스트: `/tags`, `/tags/[tag]` -> 위키 라우트 리다이렉트, 비정상 태그 폴백 및 canonical 정책 검증
- [ ] UI 테스트: Playwright `360/768/1440` + `toHaveScreenshot` + `@axe-core/playwright`를 적용해 홈 위키 뷰/내비게이션 조건부 노출 회귀 검증
- [ ] 기존 UI 테스트 전환 전략
  - [ ] `tests/ui/posts-archive.spec.ts`: 공개 접근 시나리오를 비관리자 리다이렉트 검증으로 전환하고, 필요 시 관리자 인증 선행 시나리오로 분리
  - [ ] `tests/ui/posts-search-autocomplete.spec.ts`: `/posts` 직접 접근 전제 제거 후 관리자 인증 기반 검색 시나리오로 재정의
  - [ ] `tests/ui/tags-index.spec.ts`: `/tags*` 직접 렌더링 전제 제거 후 위키 리다이렉트/폴백 검증으로 대체
- [ ] 신규 핵심 접근 제어 시나리오
  - [ ] 비관리자 `GET /`, `/posts`, `/posts/[slug]`, `/tags`, `/tags/[tag]` 접근 시 `302 -> /admin/login?next=...` 검증
  - [ ] 관리자 인증 후 동일 경로 접근 허용 및 화면 렌더링 검증
  - [ ] 태그 경로가 `/wiki` 또는 `/wiki/[...path]`로 정책대로 연결되는지 검증, 변환 실패 시 404 검증
- [ ] API 정책 검증: `/api/posts`, `/api/posts/suggest`의 비관리자 401 응답 계약을 테스트로 고정
- [ ] 전체 회귀: `npm run test:all` 실행
- [ ] 문서 동기화 검증: `plans/use-cases.md`, `docs/codebase.md` 변경 반영 확인

## 릴리즈/롤백 체크
- [ ] 배포 직후 확인 URL: `/`, `/wiki`, `/admin/login`, `/api/health`
- [ ] 관리자 로그인 후 핵심 동선(`/admin/write`, 관리자 전용 포스트 접근) 수동 스모크 점검
- [ ] 롤백 트리거: 비관리자/관리자 모두에서 리다이렉트 루프 발생, 또는 정상 API가 광범위하게 401로 오동작
