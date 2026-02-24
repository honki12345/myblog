# ISSUE #127 글 상세 액션 버튼 레이아웃 붕괴 수정

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/127
- Issue 번호: 127
- 기준 브랜치: main
- 작업 브랜치: fix/issue-127-post-detail-action-buttons-layout
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/fix/issue-127-post-detail-action-buttons-layout
- 작성일: 2026-02-24

## 배경/문제
글 상세 페이지(`/posts/[slug]`)의 관리자 액션 버튼(`수정`, `읽음으로 표시`, `삭제`)이 특정 뷰포트와 버튼 상태 조합에서 줄바꿈/겹침/정렬 붕괴를 일으킨다. 상태 텍스트가 길어질 때 조작성이 떨어지고 UI 일관성이 깨진다.

## 목표
- [x] 관리자 액션 버튼 3개가 모바일/태블릿/데스크톱에서 안정적으로 배치되도록 수정한다.
- [x] 상태 텍스트 길이 변화에도 버튼 영역이 겹치거나 비정상 줄바꿈되지 않도록 보장한다.

## 완료 기준 (Definition of Done)
- [x] `360/768/1440` 뷰포트에서 관리자 액션 영역 수평 오버플로우가 발생하지 않는다.
- [x] `360` 뷰포트에서 관리자 액션 버튼 3개가 세로 스택 순서(`수정 → 읽음 토글 → 삭제`)로 유지된다.
- [x] `읽음으로 표시`/`읽지 않음으로 표시`/`변경 중…`/`삭제 중…` 라벨 상태에서 버튼 겹침/클리핑이 없다.
- [x] `tests/ui/post-admin-actions.spec.ts`의 기능 assertion과 a11y(serious/critical 0) 검증이 유지된다.
- [x] 관련 스냅샷 갱신 영향 경로 점검이 완료된다.

## 범위
### 포함
- `src/app/posts/[slug]/PostAdminActionsClient.tsx` 레이아웃 구조/스타일 조정
- 필요 시 `src/app/posts/[slug]/page.tsx`의 상위 컨테이너 레이아웃 보정
- Playwright 기반 UI 회귀 테스트 보강
  - 1차 검증: `tests/ui/post-admin-actions.spec.ts` (기능 assertion + 수평 오버플로우 + a11y + 스냅샷)
  - 영향 확인: `tests/ui/visual-regression.spec.ts`, `tests/ui/dark-mode-risk.spec.ts`, `tests/ui/wiki-view.spec.ts` 내 `/posts/[slug]` 관련 스냅샷

### 제외
- 관리자 액션의 기능 동작 자체(수정/읽음 토글/삭제 API 계약) 변경
- 글 상세 페이지 내 관리자 액션 영역 외 다른 컴포넌트 리디자인

## 구현 단계
1. [x] 분석 및 재현
   - [x] `docs/codebase.md`의 `Sync Anchor (main)`과 `Task Context Map` 확인 기록
2. [x] 구현
3. [x] 테스트
4. [x] 문서화/정리
   - [x] 기능/테스트 변경 시 `plans/use-cases.md` 유스케이스 명세/Traceability Matrix 동시 갱신

## 리스크 및 확인 필요 사항
- 버튼 텍스트 로케일/상태 문구 변경 시 다시 레이아웃이 깨질 수 있음
- 모바일 정책(세로 스택) 변경 시 레이아웃 회귀 가능성
- 상태 전이 중 라벨 길이(예: `변경 중…`)에 따라 일시 레이아웃 흔들림 가능성
- 기존 시각 회귀 스냅샷 업데이트 범위 검토 필요

## 결정 로그
- 2026-02-24: 모바일(`360`) 관리자 액션 버튼은 **세로 3단 스택**으로 고정한다.
- 사유: 상태 라벨 길이 변화 시 겹침/클리핑/오버플로우 리스크를 최소화하고 터치 타깃 분리를 안정적으로 유지하기 위함.

## 검증 계획
- [x] `npm run test:ui:visual`에서 최소 뷰포트 `360/768/1440` 기준 스냅샷 회귀 확인
- [x] 관리자 로그인 상태에서 `/posts/[slug]` 액션 버튼 기능 assertion 유지 확인
- [x] 읽음 상태 토글 전/후(`읽음으로 표시` ↔ `읽지 않음으로 표시`) 및 진행 중 라벨(`변경 중…`)에서 레이아웃/수평 오버플로우 유지 확인
- [x] 모바일(`360`)에서 버튼 3개가 최소 터치 타깃과 시각적 분리를 유지하는지 확인(겹침/클리핑 없음)
- [x] 모바일(`360`)에서 버튼 배치가 세로 3단 스택(`수정 → 읽음 토글 → 삭제`)으로 고정되는지 확인
- [x] 스냅샷 갱신 영향 경로 확인
  - `tests/ui/post-admin-actions.spec.ts-snapshots/`
  - `tests/ui/visual-regression.spec.ts-snapshots/`의 `post-detail-*`
  - `tests/ui/dark-mode-risk.spec.ts-snapshots/`의 `dark-post-detail-*`
  - `tests/ui/wiki-view.spec.ts-snapshots/`의 `post-detail-comments-admin-*`
- [x] PR 전 최종 회귀로 `npm run test:all`을 반드시 실행하고, 실패 시 수정 후 전체 재실행

## 실행 로그
- 2026-02-24: 관리자 액션 버튼 레이아웃을 모바일 세로 스택 + `sm` 이상 가로 정렬로 재구성하고 `수정` 링크를 `PostAdminActionsClient`로 이동.
- 2026-02-24: `tests/ui/post-admin-actions.spec.ts`에 모바일 스택 순서 및 진행 상태(`변경 중…`/`삭제 중…`) 오버플로우 검증 추가.
- 2026-02-24: `plans/use-cases.md`의 `UC-ADMIN-003` 수용기준/Traceability Matrix 갱신.
- 2026-02-24: `PLAYWRIGHT_PORT_BASE=3499 npm run test:all` 최종 통과(`total done in 8m 5s`).
