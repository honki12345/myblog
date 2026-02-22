# ISSUE #113 feat: 홈(/)·위키(/wiki) 통합 및 위키 탐색 UX 정리

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/113
- Issue 번호: 113
- 기준 브랜치: main
- 작업 브랜치: feat/wiki-integration-ux-cleanup
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/feat/wiki-integration-ux-cleanup
- 작성일: 2026-02-22

## 배경/문제
- 공개 진입점인 /와 /wiki가 기능적으로 겹쳐 정보 구조가 분산되어 보임.
- 위키 카테고리 탐색에서 동일 항목 재클릭 시 펼침/선택/복귀 동작이 직관적이지 않음.
- 위키 상세/댓글 영역의 '블로그 글 보기' 링크 노출 대상을 관리자 세션으로 제한할 필요가 있음.
- 위키 루트 카드가 일반 카드와 시각적으로 유사해 탐색 affordance가 약함.

## 목표
- [ ] /를 /wiki로 통합 리다이렉트하고 헤더 타이틀 링크 목적지를 일치시킨다.
- [ ] 위키 트리에서 현재 선택(검은색 활성)된 카테고리를 다시 클릭하면 하위 트리를 닫고, 비활성 카테고리 클릭은 선택 동작만 수행하게 한다.
- [ ] '블로그 글 보기' 링크를 관리자 세션에서만 노출한다.
- [ ] 위키 루트 카드를 일반 카드와 시각적으로 구분한다.
- [ ] 관련 자동화 테스트와 문서를 갱신한다.

## 범위
### 포함
- / -> /wiki 통합 리다이렉트
- 헤더 타이틀 링크 목적지 /wiki로 조정
- 위키 트리에서 활성(검은색) 경로 재클릭 시 닫힘 토글, 비활성 경로 클릭 시 선택만 수행
- 관리자 세션 조건부 '블로그 글 보기' 렌더링
- 위키 루트 카드 UI 구분 스타일 적용
- 관련 테스트 갱신 및 docs/codebase.md, plans/use-cases.md 동기화
- docs/codebase.md 동기화 범위: `/` 라우팅/권한 정책, 위키 탐색 상태 동기화, 공통 불변식 섹션
- plans/use-cases.md 동기화 범위: `UC-VISIBILITY-001`, `UC-WIKI-002`, Traceability Matrix

### 제외
- 위키 외 영역의 정보 구조 재설계
- 관리자 권한 체계/인증 방식 자체 변경
- 전면적인 디자인 시스템 리뉴얼

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

## 영향 파일/모듈
- 라우팅/헤더
  - `src/app/page.tsx`: `/` -> `/wiki` 리다이렉트 전환
  - `src/components/HomeTitleLink.tsx`: 헤더 타이틀 링크 목적지 및 현재 페이지 처리 기준 조정
- 위키 탐색/권한 노출
  - `src/components/wiki/WikiExplorerClient.tsx`: 활성 경로 재클릭 닫힘 토글, `'블로그 글 보기'` 관리자 조건부 렌더링
  - `src/app/wiki/page.tsx`, `src/app/wiki/[...path]/page.tsx`: 관리자 세션 판별값 전달(`isAdmin`) 및 props 연결
- 회귀 테스트/검증
  - `scripts/test-step-5.mjs`: `/` 동작(리다이렉트) 기준 갱신
  - `tests/ui/home-empty-state.spec.ts`, `tests/ui/home-scroll-top.spec.ts`: 홈 경로 전환에 따른 시나리오/선택자 조정
  - `tests/ui/wiki-view.spec.ts`: 활성 경로 재클릭 닫힘 및 `'블로그 글 보기'` 관리자 노출 조건 검증 추가
  - `tests/ui/accessibility.spec.ts`, `tests/ui/visual-regression.spec.ts`: 주요 대상 경로(`/`, `/wiki`) 및 스냅샷 기준 업데이트

## 리스크 및 확인 필요 사항
- / 리다이렉트 적용 시 기존 북마크/SEO 신호/내부 링크 영향 점검 필요
- 카테고리 클릭의 선택/토글 규칙이 접근성(키보드/스크린리더)과 충돌하지 않도록 확인 필요
- 관리자 세션 판별 조건이 서버/클라이언트 렌더링 경계에서 일관적인지 확인 필요
- 루트 카드 시각 변경이 모바일(360)에서 정보 밀도를 해치지 않는지 확인 필요

## 검증 계획
- [ ] npm run test:all
- [ ] npm run test:step5
- [ ] npm run test:step11
- [ ] npm run test:ui:functional
- [ ] 필요 시 npm run test:ui:update 후 npm run test:ui:visual
- [ ] Playwright 기능 assertion으로 수용 기준(활성 경로 재클릭 닫힘 포함 리다이렉트/권한 노출/UI 구분) 자동 검증
- [ ] Playwright a11y 검사(`@axe-core/playwright`)와 시각 회귀(`360/768/1440`) 결과 확인

## 테스트 시나리오 매트릭스
| # | 구현 계획 항목 | 테스트 반영 | 테스트 유형 | 검증 포인트 |
| --- | --- | --- | --- | --- |
| 1 | `/` -> `/wiki` 리다이렉트 | `scripts/test-step-5.mjs`, `tests/ui/accessibility.spec.ts` | INTEGRATION, E2E | 상태 코드/최종 URL, 접근성 회귀 확인 |
| 2 | 헤더 타이틀 링크 목적지 `/wiki` | `tests/ui/home-scroll-top.spec.ts`(수정), `tests/ui/visual-regression.spec.ts` | E2E, REALISTIC | 타이틀 링크 href/현재 페이지 표시/키보드 포커스 동작 |
| 3 | 활성 경로 재클릭 시 닫힘 토글 | `tests/ui/wiki-view.spec.ts`(보강) | E2E | 활성 경로 재클릭 전/후 expanded 상태 및 하위 노드 노출 변화 |
| 4 | `'블로그 글 보기'` 관리자 조건부 노출 | `tests/ui/wiki-view.spec.ts`(보강), `scripts/test-step-11.mjs` | E2E, INTEGRATION | 비관리자 숨김/관리자 노출, 링크 target slug 정확성 |
| 5 | 위키 루트 카드 시각 구분 | `tests/ui/visual-regression.spec.ts` | REALISTIC | `/wiki` 루트 카드의 시각적 차별성과 360/768/1440 스냅샷 안정성 |

## 테스트 통과 기준
- `npm run test:all`이 성공해야 한다.
- `npm run test:ui:functional`에서 기능 assertion과 a11y 검사(`@axe-core/playwright`)가 모두 통과해야 한다.
- UI 변경으로 시각 기준선 갱신이 필요하면 `npm run test:ui:update` 후 `npm run test:ui:visual`에서 diff 검토까지 완료해야 한다.

## 결정 사항 (관점 6 확정)
- `/` 진입은 `/wiki`로 `308 Permanent Redirect`를 사용한다.
- 위키 트리에서 활성 경로 재클릭 시 선택 경로는 유지하고 하위 트리만 접는다.
- 비관리자 세션에서는 `'블로그 글 보기'` 링크를 DOM 포함 완전 미노출한다.
- `/wiki`에서 헤더 타이틀(목적지 `/wiki`) 재클릭 시 스크롤을 최상단으로 이동한다.

## 완료 기준 (Definition of Done)
- 기능 완료: `/` -> `/wiki` 리다이렉트, 활성 경로 재클릭 닫힘 토글, `'블로그 글 보기'` 관리자 조건부 노출, 위키 루트 카드 시각 구분이 모두 동작한다.
- 테스트 완료: `npm run test:all` 및 본 문서의 테스트 시나리오 매트릭스 항목이 모두 통과한다.
- 문서 완료: `docs/codebase.md`(`/` 라우팅/권한 정책, 위키 탐색 상태 동기화, 공통 불변식`)와 `plans/use-cases.md`(`UC-VISIBILITY-001`, `UC-WIKI-002`, Traceability Matrix`)가 최종 구현 기준으로 갱신된다.

## 롤백 기준
- 배포 전 검증에서 `/` 리다이렉트로 인해 접근성 또는 탐색 회귀가 확인되면 `src/app/page.tsx`의 리다이렉트 변경을 우선 원복하고 원인 수정 후 재검증한다.
