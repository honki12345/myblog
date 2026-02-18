# ISSUE #77 feat: 헤더 홈 링크 중복 제거 + 홈에서 재이동 동작 보장

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/77
- Issue 번호: 77
- 기준 브랜치: main
- 작업 브랜치: feat/issue-77-home-link-dedup-scroll-top
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/feat-issue-77-home-link-dedup-scroll-top
- 작성일: 2026-02-18

## 배경/문제
- 헤더에 홈으로 가는 링크가 2개(타이틀 `honki12345 블로그` + 메뉴 `홈`)로 중복되어 있다. (`src/app/layout.tsx`)
- 현재 경로가 이미 `/`인 상태에서 `홈` 또는 타이틀 링크를 클릭해도 화면 변화가 거의 없어, 사용자가 "홈으로 다시 돌아가기" 동작(예: 스크롤 최상단 복귀)을 기대할 때 피드백이 약하다.

## 목표
- [ ] 홈 링크를 1개로 통일해 중복 UI를 제거한다.
- [ ] 타이틀(홈 링크) 클릭 동작을 정의한다.
- [ ] 현재 경로가 `/`인 경우에도 클릭 시 "홈으로 돌아감" 동작이 체감되도록 처리한다.
- [ ] 접근성/키보드 내비게이션(포커스, 탭 이동)을 확인한다.

## 완료 기준
- [ ] 헤더에 홈 링크가 1개만 존재한다.
- [ ] (테스트 기준) 헤더에서 `a[href="/"]`가 1개다.
- [ ] 현재 경로가 `/`에서 스크롤을 내린 뒤 타이틀(홈 링크)을 클릭하면 스크롤이 최상단으로 복귀한다.
- [ ] 접근성: 타이틀(홈 링크)이 명확한 포커스 스타일을 가지며, 키보드 탭 이동이 자연스럽다.
- [ ] Playwright UI 테스트(스크린샷/기능 assertion)가 추가 또는 갱신된다.
- [ ] 회귀 게이트: `npm run test:all` 통과

## 범위
### 포함
- `src/app/layout.tsx`에서 중복된 메뉴 `홈` 링크 제거(타이틀 링크를 홈 역할로 유지)
- 타이틀(홈 링크) 클릭 시 동작 보장(특히 `/`에서)
- Playwright UI 테스트 추가/갱신(스크린샷 + 기능 assertion) + 기존 a11y 회귀 유지(필요 시 보강)

### 제외
- 헤더 전체 리디자인/메뉴 구조 전면 개편
- (별도 이슈로) 홈 화면 데이터 로딩/캐시 정책 변경
- (별도 이슈로) 전역 스크롤 복원 정책 전면 변경

## 구현 단계
1. [ ] 현행 동작/구조 확인
- `src/app/layout.tsx` 및 헤더 관련 컴포넌트 구조 확인(서버/클라이언트 컴포넌트 경계 포함)
- 홈 링크(타이틀/메뉴)의 실제 DOM/탭 순서 확인

2. [ ] 구현
- 메뉴 `홈` 링크 제거(타이틀 링크만 홈 링크로 유지)
- `/`에서 타이틀(홈 링크) 클릭 시 스크롤 최상단 복귀 동작 제공(예: `window.scrollTo({ top: 0 })`)
- 스크롤 복귀는 `prefers-reduced-motion`을 존중해 reduced motion이면 `auto`, 아니면 `smooth`로 처리
- Next.js App Router 제약(서버 레이아웃에서 이벤트/`window` 접근 불가)에 맞게 타이틀 링크를 클라이언트 컴포넌트로 분리(레이아웃은 서버 유지)
  - 예: `src/components/HomeTitleLink.tsx`(client)로 타이틀 `<Link />`를 교체하고, `/`일 때 `window.scrollTo({ top: 0 })` 처리 + `usePathname()`으로 `/`인 경우 `aria-current="page"` 적용
  - `/`에서 일반 좌클릭(수정키 없음)일 때만 `preventDefault()` 후 스크롤 탑 처리하고, 새 탭/새 창(⌘/Ctrl/Shift/Alt 클릭, 중클릭 등)은 기본 링크 동작 유지
- 접근성: 타이틀(홈 링크)에 `aria-label`로 "홈" 의미를 명시하고(`/`에서는 `aria-current="page"` 적용), 키보드 사용자 피드백을 위해 `:focus-visible` 포커스 스타일 보강

3. [ ] 테스트
- Playwright: `/`에서 스크롤 후 타이틀 클릭 -> 스크롤 최상단 복귀 assertion
- Playwright: 헤더에서 `a[href="/"]`가 1개인지 assertion(홈 링크 중복 제거 회귀 고정) (권장: `header` 범위로 제한)
- Playwright: `/`에서 타이틀 클릭 후 `window.scrollY === 0` assertion(스크롤 최상단 복귀)
- (권장) `tests/ui/home-scroll-top.spec.ts` 신규: `/`에서 스크롤 발생(`scrollY > 0`)을 먼저 확인한 뒤, 타이틀 클릭 후 `expect.poll(() => window.scrollY).toBe(0)`로 안정적으로 검증(smooth 대비)
- (권장) a11y 속성 회귀: `/`에서 타이틀 링크에 `aria-label`/`aria-current="page"` assertion 추가(axe와 별개로 고정)
- Visual regression: 헤더 메뉴 변경 반영(`toHaveScreenshot`, 최소 뷰포트 360/768/1440)
- 접근성: 키보드 탭 이동 및 포커스 확인 + 기존 `@axe-core/playwright` a11y 스펙 통과 유지(필요 시 보강)
  - (권장) Playwright로 타이틀에 포커스를 주고 `:focus-visible` 스타일이 적용되는지 + 탭 순서가 자연스러운지 최소 1개 assertion으로 고정

4. [ ] 문서화/정리
- 이슈 본문 체크리스트 업데이트(완료 표시)

## 리스크 및 확인 필요 사항
- Next.js `<Link>` 기본은 스크롤 위치 유지이며(새 페이지가 뷰포트 밖이면 첫 페이지 요소로 스크롤될 수 있음), `/`에서 "항상 스크롤 최상단 복귀" UX는 onClick으로 명시적으로 처리하는 편이 안전
- 서버 레이아웃(`src/app/layout.tsx`)에서는 이벤트/`usePathname`/`window` 접근이 불가하므로, 타이틀 링크를 클라이언트 컴포넌트로 분리하는 것이 사실상 필수(헤더에 client boundary 추가로 JS 번들/하이드레이션 영향 가능)
- 시각적 변경(메뉴 항목 제거)이 스크린샷 스냅샷에 영향을 주므로 UI 테스트 갱신 필요

## 검증 계획
- [ ] `npm run test:ui` (필요 시 `npm run test:ui:update`)
- [ ] `npm run test:all`
