# ISSUE #48 fix: 로그인 시에만 글쓰기 버튼 노출

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/48
- Issue 번호: 48
- 기준 브랜치: main
- 작업 브랜치: issue-48-fix-write-link-auth
- Worktree 경로: .../.worktrees/issue-48-fix-write-link-auth
- 작성일: 2026-02-17

## 배경/문제
비로그인 상태에서도 상단 네비게이션에 `/admin/write`(글쓰기) 링크가 노출된다.
기대 동작은 관리자 인증(세션 쿠키 등) 완료 시에만 `글쓰기` 링크가 보이는 것이다.
추가로 비로그인 public UI 전반에서 `/admin/write`로 이동하는 진입 링크를 숨겨 UX를 일관되게 맞춘다. (헤더, 홈 빈 목록 CTA 등)

## 목표
- [ ] 비로그인 상태에서는 public UI에서 `/admin/write`로 이동하는 링크가 렌더링되지 않는다. (헤더, 홈 빈 목록 CTA 등)
- [ ] 관리자 로그인 상태에서는 헤더 네비게이션에 `글쓰기` 링크가 렌더링된다.
- [ ] Playwright E2E로 비로그인/로그인 두 케이스를 assertion으로 고정한다.

## 범위
### 포함
- public UI의 `/admin/write` 진입 링크를 관리자 인증 상태에 따라 조건부 렌더링 (헤더, 홈 빈 목록 CTA 등)
- 인증 판단 기준: UI 노출은 `getAdminCsrfToken()`(=`admin_csrf`) 기반, 접근 제어는 `getAdminSessionFromServerCookies()`(=`admin_session`) 기반
- Playwright E2E: 비로그인에서 `글쓰기` 미노출, 로그인에서 노출

### 제외
- 인증 방식 자체 변경(세션/쿠키 구조 변경)
- `/admin/write` 라우트 접근 제어 정책 변경(리다이렉트/권한 가드 변경)

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

### 세부 작업
- [ ] `src/app/layout.tsx`에서 헤더 네비게이션 렌더링 위치 확인
- [ ] `/admin/write` 링크가 노출되는 지점을 전체 검색해 수정 대상(헤더, CTA 등)을 목록화
- [ ] 헤더의 `글쓰기` 링크는 `admin_csrf` 쿠키(`getAdminCsrfToken()`) 기반으로 Client Component에서 조건부 렌더링 (루트 레이아웃 동적화 회피)
- [ ] 구현 방향: `AdminAuthNavButton`를 확장해 인증 시 `글쓰기` 링크 + `로그아웃`을 함께 렌더링하거나, 동등한 신규 Client Component를 추가한다
- [ ] 홈 빈 목록 CTA 등 public UI의 `/admin/write` 진입 링크도 동일하게 인증 상태에 따라 숨김 처리
- [ ] 홈 빈 목록 CTA는 서버 세션(`getAdminSessionFromServerCookies()` 기반 `isAdmin`)으로 조건부 렌더링한다
- [ ] (검증) 실제 접근 제어는 `/admin/write` 라우트의 세션 체크(`getAdminSessionFromServerCookies()`)가 기준임을 확인
- [ ] Playwright 스펙 추가(또는 기존 스펙 확장)
  - [ ] 비로그인: `/` 진입 시 헤더에서 `글쓰기` 링크가 없어야 함
  - [ ] 로그인: 관리자 로그인 수행 후 헤더에서 `글쓰기` 링크가 있어야 함

## 리스크 및 확인 필요 사항
- `layout.tsx`가 Server Component가 아니거나 렌더링 경로가 복잡하면, 인증 판별 위치를 조정해야 할 수 있음
- `layout.tsx`에서 쿠키(세션)를 읽으면 루트 레이아웃이 동적으로 바뀌어 캐시/성능에 영향을 줄 수 있음. 영향이 크면 표시 조건을 클라이언트/다른 계층으로 이동하는 대안을 검토해야 함
- `getAdminCsrfToken()`은 로그인 신호로 완벽하지 않을 수 있으므로(만료/존재), UI 노출 기준과 실제 접근 제어 기준을 분리해야 함 (접근 제어는 세션 `admin_session` 우선)
- 헤더는 클라이언트에서 `admin_csrf`로 분기하므로, 로그인 직후 `글쓰기` 링크가 hydration 이후에 나타날 수 있음 (UX적으로 허용)
- 헤더는 모든 페이지에 영향을 주므로, 조건 분기 누락 시 비로그인 노출 회귀가 재발할 수 있음(테스트로 고정 필요)

## 영향 파일
- `src/app/layout.tsx`
- `src/lib/admin-auth.ts` (필요 시)
- `src/components/AdminAuthNavButton.tsx` (또는 신규 Client Component, 헤더 글쓰기 분기/정합성 확인)
- `src/app/page.tsx` (빈 목록 CTA 등, 범위에 따라)
- `tests/ui/*.spec.ts` (신규 또는 수정)

## 완료 기준(DoD)
- [ ] 비로그인 상태에서 public UI에 `/admin/write`로 이동하는 링크가 없다. (헤더, 홈 빈 목록 CTA 등)
- [ ] 관리자 로그인 상태에서 헤더 네비게이션에 `글쓰기` 링크가 있다.
- [ ] `npm run test:ui` 통과
- [ ] PR 전 `npm run test:all` 통과

## 검증 계획
- [ ] Playwright: 헤더 네비게이션(`nav[aria-label="주요 메뉴"]`) 범위에서 `글쓰기` 링크 노출/미노출을 assertion
- [ ] Playwright: 비로그인(쿠키 없음)에서 `글쓰기` 링크 미노출 assertion
- [ ] Playwright: 관리자 로그인(`authenticateAdminSession(page, { nextPath: "/" })` 등) 후 `글쓰기` 링크 노출 assertion (헤더는 hydration 이후 노출될 수 있으니 `toBeVisible({ timeout: ... })`로 대기)
- [ ] (선택) Playwright: `글쓰기` 링크의 `href="/admin/write"` 확인 + 클릭 후 `/admin/write` 이동 확인
- [ ] Playwright: 비로그인 `/`에서 `a[href^="/admin/write"]`가 0개인지 확인 (헤더 외 CTA 포함)
- [ ] (선택) Playwright: 로그아웃 후 헤더에서 `글쓰기` 링크가 다시 미노출되는지 확인
- [ ] (선택) 시각적 회귀: 관련 페이지 헤더 스냅샷이 불안정하면 안정화(애니메이션 비활성화/고정 데이터). 헤더 변경으로 스냅샷 업데이트가 필요할 수 있음
