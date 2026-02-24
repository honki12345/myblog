# ISSUE #119 feat: honki12345 블로그 클릭 시 위키 홈으로 이동

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/119
- Issue 번호: 119
- 기준 브랜치: main
- 작업 브랜치: feat/issue-119-wiki-home-navigation
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/feat/issue-119-wiki-home-navigation
- 작성일: 2026-02-24

## 배경/문제
- 헤더의 `honki12345 블로그` 링크는 현재 `/wiki`를 가리키므로, 이 이슈에서는 해당 동작의 회귀 방지와 경로별 일관성(`/wiki`, `/wiki/[...path]`) 검증이 필요하다.
- 이미 `/wiki`에서 재클릭 시 최상단 이동 동작이 구현되어 있으므로, 정책 변경 여부를 포함해 기대 동작 유지/검증 범위를 명확히 해야 한다.
- 키보드/스크린리더 접근성과 Playwright 기반 UI/기능 회귀 검증이 필요하다.

## 목표
- [ ] 헤더 브랜드/타이틀 클릭 타깃을 `/wiki`로 고정한다.
- [ ] `/wiki` 재클릭 시 동작 정책을 정의하고 구현한다.
- [ ] 접근성(링크 역할/레이블/현재 위치 표시)을 점검하고 보완한다.
- [ ] Playwright 기반 기능/UI 테스트를 추가 또는 보강한다.

## 범위
### 포함
- 공통 헤더 링크 동작 정의 및 구현
- `/wiki`, `/wiki/[...path]`에서의 클릭 동작 일관성 확보
- 관련 접근성 속성 및 상호작용 검증
- 회귀 방지용 자동화 테스트 반영

### 제외
- 헤더 전면 리디자인
- 위키 정보 구조/라우팅 체계 개편
- 이슈 범위를 벗어난 관리자 페이지 UI 변경

## 구현 단계
1. [ ] 분석 및 재현 (현행 근거 확인: `src/components/HomeTitleLink.tsx`, `tests/ui/home-scroll-top.spec.ts`)
2. [ ] 구현 (현행 동작 유지 여부 우선 판정 후 필요 시 최소 변경)
   - 기준 동작: `src/components/HomeTitleLink.tsx`의 `/wiki` 링크 고정 + `/wiki` 재클릭 시 최상단 복원
   - 정책 변경이 없으면 코드 변경 없이 테스트/문서 보강만 수행
3. [ ] 테스트
4. [ ] 문서화/정리 (`plans/use-cases.md` Traceability Matrix 동기화 포함)

## 완료 기준 (Definition of Done)
- [ ] 기능: `/wiki` 재클릭 시 최상단 복원, `/wiki/[...path]`에서 클릭 시 `/wiki` 이동, 수정키 클릭 시 기본 링크 동작 유지
- [ ] 테스트: 관련 Playwright 기능 assertion/시각 회귀/a11y 검증이 통과
- [ ] 문서: `plans/use-cases.md` 유스케이스 및 Traceability Matrix가 변경사항과 동기화

## 리스크 및 확인 필요 사항
- 공통 헤더 변경이 다른 공개/관리자 경로의 내비게이션 기대값에 미치는 영향 검토 필요
- `/wiki` 재클릭 동작은 최상단 스크롤 이동으로 유지하고, `/wiki/[...path]` -> `/wiki` 이동 시 스크롤은 기본 라우팅 동작을 유지
- 스크린리더용 현재 위치 표기(`aria-current`)는 `/wiki` 인덱스 경로에서만 적용
- 정책 변경 시 영향 범위(`src/components/HomeTitleLink.tsx`, `tests/ui/home-scroll-top.spec.ts`, `tests/ui/wiki-view.spec.ts`, 시각 스냅샷)와 롤백 기준을 사전 정의 필요

## 검증 계획
- [ ] Playwright 기능 assertion 추가/보강
  - `/wiki`에서 타이틀 클릭 시 URL은 유지되고 `window.scrollY === 0`을 만족
  - `/wiki/[...path]`에서 타이틀 클릭 시 `/wiki`로 라우팅 완료(추가 스크롤 강제 없음)
  - 수정키(⌘/Ctrl/Shift/Alt) 클릭은 기본 링크 동작 유지(`preventDefault` 미실행)
  - `aria-current="page"`는 `/wiki` 인덱스에서만 노출되는지 확인
  - 기존 `tests/ui/home-scroll-top.spec.ts` 보강 및 필요 시 `tests/ui/wiki-view.spec.ts`에 라우팅 assertion 추가
- [ ] Playwright 시각 회귀(`toHaveScreenshot`, 360/768/1440) 반영
  - 헤더(브랜드 링크 포함) 영역이 노출된 상태로 캡처하여 스타일/상태 회귀를 탐지
- [ ] 접근성 검사(`@axe-core/playwright`) 점검
- [ ] 회귀 규칙에 따라 `npm run test:all` 실행
