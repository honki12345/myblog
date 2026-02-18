# ISSUE #80 feat: 글 카드 전체 클릭 + hover/focus UX 개선

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/80
- Issue 번호: 80
- 기준 브랜치: main
- 작업 브랜치: issue-80-postcard-clickable-hover-focus
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-80-postcard-clickable-hover-focus
- 작성일: 2026-02-18

## 배경/문제
현재 글 목록 카드(`PostCard`)에서 제목 링크만 클릭 가능해서(썸네일/요약/여백 클릭 불가) 클릭 가능 영역 인지가 약하다.
카드 전체를 클릭 가능하게 하고, hover/focus 시 시각적 피드백을 추가한다.

## 목표
- [x] 글 카드 전체가 클릭 가능하다(태그 등 내부 링크는 예외).
- [x] hover/focus-visible 시 시각적 피드백이 제공된다.
- [x] `prefers-reduced-motion` 환경에서 과한 모션이 제거된다.
- [x] Playwright UI 회귀(스냅샷 + 접근성(axe) + 클릭 동작)가 고정된다.

## 요구사항 정리
### 클릭/링크
- draft(`status=draft`)는 기존대로 `/admin/write?id=<id>`로 이동한다.
- published는 `/posts/<slug>`로 이동한다.
- 중첩 링크(Anchor-in-Anchor) 없이 구현한다.
- 태그 칩 클릭은 카드 이동과 충돌하지 않게 유지한다(태그 이동 우선).
- `PostCard`는 클라이언트 컴포넌트로 바꾸지 않는다(불필요한 `onClick`/라우팅 JS 추가 금지).

### 결정 사항
- 최종 구현 패턴: 타이틀 링크 stretched(pseudo-element) 방식
- 포커스 UX: 카드 컨테이너에 `focus-within` 기반 피드백을 제공한다.

### 구현 패턴 후보
- 오버레이 링크(stretched link)
  - `article`을 `relative`로 만들고, 제목을 accessible name으로 갖는 `<Link className="absolute inset-0" aria-label=...>`를 추가한다.
  - 태그/내부 링크는 `relative z-10` 등으로 오버레이보다 위로 올려 클릭 우선순위를 보장한다.
- 타이틀 링크 stretched
  - 제목 `<Link>`에 `before:absolute before:inset-0` 같은 pseudo-element로 클릭 영역을 카드 전체로 확장한다.
  - 태그/내부 링크 클릭 충돌은 z-index/position으로 분리한다.

## 범위
### 포함
- `src/components/PostCard.tsx`: 카드 전체 클릭 가능하도록 링크 영역 확장
- Hover/Focus UI 효과 추가(예: border/shadow/translate/title underline, cursor)
- 키보드 포커스 UX 개선(`:focus-visible`/`focus-within` 링 등)
- `prefers-reduced-motion` 환경에서 모션 약화/제거(`motion-reduce:*`)
- Playwright 테스트 업데이트/추가
  - `tests/ui/visual-regression.spec.ts` 스냅샷/접근성(axe) 통과
  - 카드 클릭 영역 + 태그 링크 우선 동작 검증
    - published 카드의 썸네일/요약/여백 클릭 → `/posts/<slug>` 이동
    - 태그 칩 클릭 → `/tags/<tag>` 이동(카드 이동보다 우선)
    - 키보드 `Tab` 포커스 시 `focus-visible` 피드백 제공 확인(스냅샷 또는 assertion)
    - 썸네일 유무 분기 커버: `PW-SEED-홈 화면 글`(썸네일) + `PW-SEED-목록 화면 글`(no thumbnail)

### 제외
- JS `onClick` 기반 네비게이션 전환
- 카드 레이아웃의 대규모 리뉴얼(정보 구조 변경, 카드 내 새로운 액션 추가)

## 구현 단계
1. [x] 분석
2. [x] 구현
3. [x] 테스트
4. [x] 문서화/정리

### 세부 작업
- [x] (UI) `PostCard`에 stretched-link 패턴 적용(서버 컴포넌트 유지)
- [x] (UI) 태그/내부 링크 클릭 우선순위 보장(z-index/stacking)
- [x] (UI) hover/focus-within/focus-visible 스타일 추가
- [x] (UI) `motion-reduce:*`로 모션 약화/제거
- [x] (테스트) visual regression 스냅샷 업데이트 + axe 통과
- [x] (테스트) 카드 클릭 이동/태그 클릭 우선 동작 검증
- [x] (테스트) 키보드 탭 포커스 시 `focus-visible` 피드백 검증

## 리스크 및 확인 필요 사항
- stretched-link(클릭 영역 확장) 구현은 태그 클릭을 가로챌 수 있으므로, stacking context를 명확히 설계해야 한다.
- 기존 테스트가 "카드 내 첫 포커스 가능한 요소"의 accessible name을 글 제목으로 기대할 수 있으므로(visual-regression), 링크 구조/aria-label을 깨지 않게 주의한다.
- `tests/ui/visual-regression.spec.ts`가 `article[data-post-card]`로 카드를 찾으므로 `data-post-card` attribute를 유지한다.
- hover 효과(translate/shadow)가 스크린샷 flake를 유발할 수 있으므로 `motion-reduce:*` 및 애니메이션 비활성화 규칙을 준수한다.

## 영향 파일(예상)
- `src/components/PostCard.tsx`
- `src/components/TagList.tsx`
- `tests/ui/visual-regression.spec.ts`

## 완료 기준(DoD)
- [x] 마우스로 카드의 썸네일/요약/여백을 클릭해도 페이지 이동한다.
- [x] 태그 칩 클릭 시 카드 이동이 일어나지 않고 태그 이동이 우선한다.
- [x] 키보드 탭 이동 시 `focus-visible`/`focus-within` 피드백으로 클릭 가능 영역을 인지할 수 있다.
- [x] `npm run test:all`이 통과한다.

## PR 리뷰 반영 내역 (2026-02-18)
- Copilot 인라인 코멘트(2820748537): `transition-colors` + `transition-shadow` 동시 사용 시 `transition-property` 덮어쓰기 가능성 → `transition`으로 통합
  - 반영 커밋: `885d193`
  - 검증: `npm run format:check`, `npm run test:ui:fast`
