# ISSUE #117 fix: 카테고리 트리 토글 후 재클릭 시 펼침 불가

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/117
- Issue 번호: 117
- 기준 브랜치: main
- 작업 브랜치: fix/issue-117-category-tree-retoggle-expand
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/fix/issue-117-category-tree-retoggle-expand
- 작성일: 2026-02-24

## 배경/문제
카테고리 트리에서 동일 카테고리를 클릭해 펼친 뒤 다시 클릭해 닫고, 다시 클릭하면 카테고리가 다시 펼쳐지지 않습니다.
이로 인해 사용자가 동일 카테고리를 재탐색할 수 없어 탐색 UX가 저하됩니다.

## 목표
- [ ] 동일 카테고리 재클릭 시 하위 트리가 정상적으로 다시 펼쳐지도록 수정
- [ ] 동일 회귀를 방지할 테스트를 추가

## 범위
### 포함
- 카테고리 트리 토글 상태 관리 로직 분석 및 수정
- 활성 경로 링크 재클릭 시 하위 트리 접기/재펼치기 토글 동작 보정 (선택 경로/URL/history 유지)
- 토글 상호작용 회귀 테스트 보강
- 작업 대상 경로: `src/components/wiki/WikiExplorerClient.tsx`, `src/app/wiki/**`, `tests/ui/wiki-view.spec.ts`

### 제외
- 카테고리 트리 UI 전면 개편
- 위키 외 페이지의 네비게이션 구조 변경

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 유스케이스/추적성 동기화 (`plans/use-cases.md` 명세 및 Traceability Matrix 갱신)
5. [ ] 문서화/정리

## 리스크 및 확인 필요 사항
- 토글 상태 관리 방식 변경 시 기존 펼침 상태 유지 로직과 충돌 가능성
- 카테고리 키 매핑 기준이 불안정하면 일부 노드에서만 증상이 재발할 수 있음

## 검증 계획
- [ ] 단위/통합 테스트
- [ ] Playwright 기능 시나리오 검증 (열기 → 닫기 → 재열기)
- [ ] 재클릭 기반 토글 검증: `+` 버튼 대신 동일 경로 링크 재클릭만으로 하위 트리 닫기/재열기 확인
- [ ] 히스토리 무결성 검증: 재클릭 토글 과정에서 `window.history.length` 불변
- [ ] 경로 상태 검증: 토글 과정에서 선택 경로/URL(`/wiki/{path}`) 유지
- [ ] Playwright 시각 회귀 검증 (`toHaveScreenshot`, viewport `360/768/1440`)
- [ ] Playwright 접근성 검증 (`@axe-core/playwright`)
- [ ] 타깃 회귀 테스트 실행: `npm run test:ui:functional -- tests/ui/wiki-view.spec.ts`
- [ ] 위키 계약 테스트 실행: `npm run test:step11`
- [ ] 기능 변경 후 PR 전 전체 회귀 실행 (`npm run test:all`)

## 완료 기준
- [ ] 동일 경로 링크 재클릭만으로 하위 트리가 `닫기 → 재열기` 동작을 만족한다.
- [ ] `tests/ui/wiki-view.spec.ts`에 재클릭 기반 회귀 시나리오가 반영되어 실패 재현 및 수정 후 통과를 확인했다.
- [ ] `npm run test:ui:functional -- tests/ui/wiki-view.spec.ts`, `npm run test:step11`, `npm run test:all`이 모두 통과한다.
- [ ] `plans/use-cases.md` 관련 유스케이스 명세와 Traceability Matrix가 갱신되었다.
