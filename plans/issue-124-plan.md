# ISSUE #124 feat: 다크 모드 UI/UX 리스크 점검 항목 정리

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/124
- Issue 번호: 124
- 기준 브랜치: main
- 작업 브랜치: feat/issue-124-dark-mode-ui-ux-risk-checklist
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/feat/issue-124-dark-mode-ui-ux-risk-checklist
- 계획 문서 경로: plans/issue-124-plan.md
- 작성일: 2026-02-24

## 배경/문제
다크 모드 도입/확장 시 색 대비, 상태 표현, 오버레이 가독성, 렌더링 플리커 등 UI/UX 리스크가 동시에 발생할 수 있다. 현재 이슈는 구현 이전에 점검 항목과 완료 기준을 명확히 정의해 회귀를 줄이는 것을 목표로 한다.

핵심 문제 축:
- 색 대비/상태 색상/아이콘 역상 등 시각 인지성 저하
- 코드 블록/표/KaTeX/Mermaid/폼 상태의 가독성 저하
- 초기 테마 적용 시 FOUC 및 hydration mismatch 가능성
- viewport(360/768/1440)별 시각 회귀 기준 미정의

## 목표
- [x] 다크 모드 UI/UX 리스크를 체크리스트 형태로 문서화한다.
- [x] 핵심 화면(공개 위키/관리자 주요 화면)의 다크 모드 회귀 기준을 확정한다.
- [x] 접근성 기준(WCAG AA, axe-core)과 시각 회귀 기준(Playwright screenshot)을 테스트 가능한 형태로 정리한다.
- [x] `plans/use-cases.md`의 다크 모드 관련 유스케이스/Traceability Matrix 갱신 항목을 확정한다.

## 범위
### 포함
- 다크 모드 색 대비/상태 색/아이콘/오버레이/폼 상호작용 상태 점검 항목 정리
- `prefers-color-scheme`/`forced-colors`/`prefers-contrast`/`prefers-reduced-motion` 조합 점검 기준 정의
- Playwright 시각 회귀 기준(360/768/1440) 정의
- `plans/use-cases.md` 다크 모드 관련 유스케이스/Traceability 반영 항목 도출
- 다크 모드 UI/UX 리스크 항목에 대한 실제 수정(스타일/컴포넌트/UI 상호작용) 반영

### 제외
- 실제 다크 모드 기능 구현/디자인 시스템 전면 개편
- 이슈 범위를 벗어난 신규 페이지 추가 및 IA 변경
- 서버/DB 스키마 변경

## 구현 단계
1. [x] 분석 및 재현
2. [x] 수정 구현(핵심 + 관리자 워크스페이스 범위)
3. [x] 테스트
4. [x] 문서화/정리

### 산출물 정의
- [x] 체크리스트/완료 기준 본문은 `plans/issue-124-plan.md`에 유지한다.
- [x] 다크 모드 관련 유스케이스/Traceability 변경점은 `plans/use-cases.md`에 반영한다.
- [x] 검증 근거는 기존 자동화 테스트(`tests/ui/visual-regression.spec.ts`, `tests/ui/accessibility.spec.ts`)를 우선 재사용하고, 부족한 항목은 범위 내에서 보강한다.
- [x] 수정 대상 화면 범위는 다음을 포함한다:
  - 핵심 화면: `/wiki`, `/posts`, `/posts/[slug]`, `/admin/write`, `/admin/login`
  - 관리자 워크스페이스: `/admin/notes`, `/admin/todos`, `/admin/schedules`, `/admin/guestbook`

## 리스크 및 확인 필요 사항
- 현재 스타일 토큰 구조에서 라이트/다크 공통 토큰 분리가 충분한지 확인 필요
- Markdown 렌더링 결과물(Shiki/KaTeX/Mermaid)의 다크 모드 테마 일관성 확인 필요
- 회귀 테스트 기준 스냅샷의 안정화 조건(애니메이션/시간대/시드 데이터) 고정 필요

## 다크 모드 UI/UX 리스크 체크리스트 (확정본)
- [x] 텍스트/배경 대비: 공통 토큰(`globals.css`) 기반으로 라이트/다크 대비를 분리하고 `body` 하드코딩 색상 제거로 초기 테마 불일치(FOUC/hydration mismatch) 위험을 완화했다.
- [x] 상태 표현(hover/focus/error/disabled): 핵심/관리자 화면의 `text/border/bg/ring/ring-offset` 클래스에 다크 변형을 추가하고 고대비 포커스 스타일을 기본 레이어에 반영했다.
- [x] Markdown 가독성: 본문/프리뷰의 heading/link/code/table/mermaid/katex 스타일에 다크 변형을 적용했다.
- [x] 렌더링 일관성: Mermaid 렌더러가 `prefers-color-scheme`, `prefers-contrast`, `forced-colors`를 반영해 테마를 선택하도록 수정했다.
- [x] 핵심 화면 커버리지: `/wiki`, `/posts`, `/posts/[slug]`, `/admin/login`, `/admin/write` 다크 스냅샷을 `360/768/1440`로 고정했다.
- [x] 관리자 워크스페이스 커버리지: `/admin/notes`, `/admin/todos`, `/admin/schedules`, `/admin/guestbook` 다크 스냅샷을 `360/768/1440`로 고정했다.
- [x] 접근성/기능 검증: `forced-colors` + `prefers-contrast` 조합에서 키보드 포커스/수평 오버플로우/axe serious·critical 0건을 검증했다.

## 검증 계획
- [x] Playwright 기능 assertion + 시각 회귀(`toHaveScreenshot`) + 접근성 검사(`@axe-core/playwright`)를 수행한다.
- [x] 시각 회귀는 최소 viewport `360/768/1440` 기준으로 검증한다.
- [x] 스냅샷 안정화 조건(애니메이션 비활성화, 고정 시드 데이터, 고정 타임존/로케일, diff 아티팩트 보관)을 점검한다.
- [x] 시각 회귀 baseline 생성/검증 환경(OS, 브라우저 채널, 렌더링 환경)을 CI에서 고정한다.
- [x] WCAG AA 텍스트 대비 기준(일반 텍스트 4.5:1, 대형 텍스트 3:1) 충족 여부를 체크리스트에 포함한다.
- [x] Step 2 이후 기능 변경 및 PR 전 `npm run test:all`을 실행한다.

### 커버리지 매핑
| # | 점검 항목 | 테스트 계획 반영 여부 | 테스트 유형 | 연결 테스트 |
|---|---|---|---|---|
| 1 | 헤더/내비게이션(위키/관리자 상태) 시인성 | COVERED | E2E + VISUAL | `tests/ui/visual-regression.spec.ts`, `tests/ui/wiki-view.spec.ts` |
| 2 | 위키 트리/상세(경로/상위 버튼/오버플로우) 가독성 | COVERED | E2E + VISUAL | `tests/ui/wiki-view.spec.ts`, `tests/ui/visual-regression.spec.ts` |
| 3 | Markdown 본문(코드블록/표/KaTeX/Mermaid) 가독성 | COVERED | E2E + VISUAL | `tests/ui/visual-regression.spec.ts`, `tests/ui/wiki-view.spec.ts` |
| 4 | 폼 상태(포커스/에러/disabled) 대비 및 상태 전달 | COVERED | E2E + A11Y + VISUAL | `tests/ui/dark-mode-risk.spec.ts`, `tests/ui/accessibility.spec.ts`, `tests/ui/visual-regression.spec.ts` |
| 5 | 오버레이/모달/드로어 계층 대비 | COVERED | E2E + VISUAL | `tests/ui/dark-mode-risk.spec.ts`, `tests/ui/wiki-view.spec.ts` |
| 6 | 썸네일/이미지 fallback 및 텍스트 대비 | COVERED | E2E + VISUAL | `tests/ui/visual-regression.spec.ts` |
| 7 | 접근성(serious/critical 위반) | COVERED | A11Y | `tests/ui/accessibility.spec.ts`, `tests/ui/visual-regression.spec.ts` |
| 8 | `forced-colors`/`prefers-contrast` 조합 | COVERED | E2E + A11Y | `tests/ui/dark-mode-risk.spec.ts` |

- [x] `PARTIAL`/`MISSING` 항목은 본 이슈에서 우선 테스트/수정을 수행하고, 불가피한 잔여 항목만 후속 이슈로 분리한다.
- 잔여 항목: 없음 (후속 이슈 분리 불필요)

## 우선순위 규칙
- P0: 텍스트 대비/가독성/WCAG AA, 초기 테마 적용(FOUC/hydration), 핵심 경로(`360/768/1440`) 회귀
- P1: 상태 색상(hover/focus/active/disabled/error), 오버레이/드로어/모달 계층 대비, Markdown 확장 렌더링 일관성
- P2: 시각 완성도 개선(미세 여백/강조 톤/부가 컴포넌트 일관성)

## 완료 기준 (Definition of Done)
- [x] 본 문서(`plans/issue-124-plan.md`)에 다크 모드 UI/UX 리스크 체크리스트와 완료 기준이 반영되어 있다.
- [x] `plans/use-cases.md`의 관련 유스케이스/Traceability Matrix 반영 항목이 업데이트되어 있다.
- [x] `npm run test:all` 실행 결과가 통과한다.
- [x] Playwright 시각 회귀 기준(`360/768/1440`) 스냅샷 검증 결과가 남아 있다.
- [x] 접근성 검사에서 serious/critical 위반이 0건이다.
- [x] `PARTIAL`/`MISSING` 항목은 본 이슈에서 우선 해소하고, 잔여 항목만 후속 이슈 번호와 함께 추적 상태가 연결되어 있다.
- [x] 수정 대상 화면(핵심 + 관리자 워크스페이스)의 리스크 항목이 점검표/테스트 결과로 해결 확인된다.

## 실행 결과 요약 (2026-02-24)
- 코드 반영:
  - 공통 테마/접근성 토큰 정비: `src/app/globals.css`, `src/app/layout.tsx`
  - 핵심/관리자 화면 다크 스타일 보강: `src/app/**`, `src/components/**` (위키/포스트/관리자 워크스페이스 포함)
  - Mermaid 다크/고대비 테마 연동: `src/components/MermaidDiagram.tsx`
  - 신규 테스트: `tests/ui/dark-mode-risk.spec.ts` + 다크 스냅샷 baseline 27장(`360/768/1440`)
- 검증 실행:
  - `npm run test:ui:visual -- --grep "dark mode snapshot" --update-snapshots` PASS
  - `npx playwright test tests/ui/dark-mode-risk.spec.ts --project={mobile-360,tablet-768,desktop-1440} --grep "forced-colors and prefers-contrast modes keep controls readable"` PASS
  - `npm run test:all` PASS (`total done in 7m 39s`)
