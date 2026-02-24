# ISSUE #128 위키 문서에서 honki12345.me/wiki 링크 클릭 시 이동되지 않는 문제

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/128
- Issue 번호: 128
- 기준 브랜치: main
- 작업 브랜치: fix/issue-128-honki12345-me-wiki
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/fix/issue-128-honki12345-me-wiki
- 작성일: 2026-02-24

## 배경/문제
위키 문서 화면에서 `https://honki12345.me/wiki`로 연결되는 링크를 클릭해도 위키 홈으로 이동하지 않고 현재 화면에 머무르는 문제가 발생한다.

## 목표
- [x] 위키 문서 내 `https://honki12345.me/wiki` 링크 클릭 시 위키 홈으로 정상 이동하도록 수정한다.
- [x] 기존 위키 내 링크 탐색 동작(상대 경로, 하위 경로, 브라우저 뒤로가기/앞으로가기)과 충돌하지 않음을 검증한다.

## 범위
### 포함
- 위키 링크 클릭 핸들링/정규화 로직 점검 및 수정
- `honki12345.me/wiki` 절대 URL 클릭 시 이동 회귀 테스트 추가 또는 보강

### 제외
- 위키 IA 구조 변경
- 위키 외 페이지(`/posts`, `/tags`, `/admin`) 내 링크 처리 변경

## 구현 단계
1. [x] 분석 및 재현
   - [x] 실패 링크 유형별 재현 기록(위키 카드/트리/브레드크럼/원문 링크)
   - [x] 재현 시 현재 URL -> 기대 URL 전이 비교(`https://honki12345.me/wiki` vs `/wiki`)
2. [x] 구현
   - [x] 대상 파일 우선 점검: `src/components/wiki/WikiExplorerClient.tsx`
   - [x] 링크 정규화 유틸 신규 추가 없이 컴포넌트 내부 파싱/정규화로 해결
3. [x] 테스트
4. [x] 문서화/정리 (`plans/use-cases.md` 유스케이스/Traceability Matrix 동기화 포함)

## 리스크 및 확인 필요 사항
- 링크 인터셉트 로직 수정 시 기존 in-app 탐색(`pushState`/`replaceState`)이 깨질 수 있음
- canonical URL(`https://honki12345.me/wiki`)은 same-origin 완전 일치만 인터셉트하고 쿼리/해시는 제거해 `/wiki`로 정규화한다.

## 검증 계획
- [x] `npm run test:step11` (위키 링크 탐색 회귀)
- [x] `tests/ui/wiki-view.spec.ts`에 `https://honki12345.me/wiki` 절대 URL 클릭 회귀 assertion 추가/보강
- [x] `scripts/test-step-11.mjs` 영향 여부 점검 및 필요 시 시나리오 보강
- [x] `npm run test:ui:functional` (링크 클릭 동작 assertion + `@axe-core/playwright`)
- [x] `npm run test:ui:visual` (스크린샷 비교 `toHaveScreenshot`, 뷰포트 `360/768/1440`)
- [x] 기능 assertion 세부 항목
  - [x] 동일 출처 절대 URL(`https://honki12345.me/wiki`) 클릭 시 `/wiki`로 이동
  - [x] 쿼리/해시 포함 절대 URL(`https://honki12345.me/wiki?x=1#y`) 클릭 시 최종 URL이 `/wiki`로 정규화됨을 확인
  - [x] 상대 URL(`/wiki`) 클릭 동작 기존 유지 확인
  - [x] `/wiki/[...path]` 상태에서 클릭 후 `Back/Forward` 히스토리 복원 확인
  - [x] 수정키/중클릭 입력에서 기본 브라우저 동작 유지(`preventDefault` 미발생)
- [x] 영향 테스트 파일 분담 명시
  - [x] 링크 클릭/히스토리 회귀: `tests/ui/wiki-view.spec.ts`
  - [x] 수정키/내비게이션 정책 회귀: `tests/ui/home-scroll-top.spec.ts`
- [x] PR 전 `npm run test:all` 실행 및 실패 시 수정 후 전체 재실행

## 완료 기준 (Definition of Done)
- [x] 기능: 동일 출처 절대 URL(`https://honki12345.me/wiki`)과 상대 URL(`/wiki`) 클릭이 모두 위키 홈 이동으로 수렴한다.
- [x] 안정성: 위키 in-place 탐색(`pushState`/`replaceState`/`popstate`) 동작과 충돌하지 않는다.
- [x] 테스트: `npm run test:step11`, `npm run test:ui:functional`, `npm run test:ui:visual`, `npm run test:all`이 모두 통과한다.
- [x] 문서: `plans/use-cases.md` 유스케이스/Traceability Matrix가 변경사항과 동기화된다.

## 실행 메모
- `src/components/wiki/WikiExplorerClient.tsx`에 same-origin 절대 URL 파싱(`parseWikiPathFromHref`)과 섹션 단위 앵커 인터셉트(`handleWikiAnchorClick`)를 추가했다.
- `tests/ui/wiki-view.spec.ts`에 절대 URL(`/wiki`, `/wiki?x=1#y`) 클릭 정규화/Back/Forward 복원 시나리오를 추가했다.
- `tests/ui/home-scroll-top.spec.ts`에 `/wiki/[...path]`에서 타이틀 클릭 후 루트 헤딩 노출/경로 헤딩 비노출 검증을 추가했다.
- 다크모드 위키 모바일 스냅샷이 현재 UI와 불일치해 `tests/ui/dark-mode-risk.spec.ts-snapshots/dark-wiki-mobile-360-linux.png`를 갱신했고, 이후 `npm run test:all`을 재실행해 전체 통과를 확인했다.

## 선행조건/의존성
- 링크 정규화 기준은 `same-origin + /wiki path` 여부를 우선 판단 기준으로 사용한다.
- `same-origin` 판정은 `https://honki12345.me`와 스킴/호스트/포트가 완전히 일치하는 URL만 허용한다.
- `https://honki12345.me/wiki` 절대 URL 인터셉트 시 쿼리/해시는 제거하고 `/wiki`로 정규화한다.
- 영향 컴포넌트/테스트 파일(`src/components/wiki/WikiExplorerClient.tsx`, `tests/ui/wiki-view.spec.ts`, `tests/ui/home-scroll-top.spec.ts`, `scripts/test-step-11.mjs`)을 최소 검토 대상으로 고정한다.
