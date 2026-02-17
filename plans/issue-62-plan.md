# ISSUE #62 feat: 글 카드 썸네일 우측 정렬

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/62
- Issue 번호: 62
- 기준 브랜치: main
- 작업 브랜치: issue-62-postcard-thumbnail-right
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-62-postcard-thumbnail-right
- 작성일: 2026-02-17

## 배경/문제
- 이슈 #49에서 글 카드(`PostCard`)에 썸네일이 추가되었고, 현재 sm 이상(>=640px)에서 썸네일이 좌측에 배치되어 있다.
- 목록에서 제목/요약 텍스트의 시작점이 카드마다 변하면서 스캔성이 떨어질 수 있어, sm 이상(>=640px)에서는 "텍스트 좌 / 썸네일 우" 배치가 더 적합할 수 있다.

## 목표
- [x] sm 이상(>=640px)에서 글 카드 레이아웃을 "텍스트 좌 / 썸네일 우"로 변경한다.
- [x] 모바일에서는 기존처럼 썸네일이 상단(세로 스택)으로 유지되도록 한다.
- [x] 접근성: 키보드 탭 이동/포커스 순서가 어색해지지 않도록 링크/DOM 구조를 정리한다.

## 완료 기준
- [x] sm 이상(>=640px): 썸네일 우측, 텍스트는 좌측에 위치한다.
- [x] 모바일(<640px): 썸네일 상단(세로 스택) 유지
- [x] 링크 구조: 썸네일은 비링크, 제목 링크만 유지한다(태그 링크는 유지).
- [x] 접근성: 키보드 탭 이동이 자연스럽다(특히 카드 내 첫 포커스가 제목 링크).
- [x] 테스트: `npm run test:ui`(필요 시 `npm run test:ui:update`) 및 `npm run test:all` 통과

## 범위
### 포함
- `src/components/PostCard.tsx` 레이아웃 조정
- 필요한 경우 `src/components/PostCardThumbnail.tsx` 스타일(사이즈/비율/overflow 등) 미세 조정
- Playwright UI 테스트(스크린샷) 추가/갱신

### 제외
- 썸네일 추출 로직(`src/lib/post-thumbnail.ts`) 변경
- 썸네일 이미지 로딩/캐시 정책 변경
- 카드 디자인(폰트/색/메타 정보 구성) 전면 개편

## 구현 단계
1. [x] 현행 UI 확인
- `PostCard`가 썸네일 유무에 따라 어떤 레이아웃 차이를 가지는지 확인
- 데스크톱/태블릿/모바일(360/768/1440)에서 카드 정렬감 확인

2. [x] 구현
- sm 이상(>=640px)에서 썸네일을 우측 컬럼으로 이동
- 모바일의 "썸네일 상단" 요구와 충돌하므로, DOM 순서 변경은 최소화하고 `sm:flex-row-reverse` 또는 `sm:order-*`로 sm 이상에서만 시각적 배치를 조정하는 방안을 우선 적용
- 링크 구조 결정(선택: 썸네일 비링크)에 따라 `PostCard`에서 썸네일을 감싸는 `<Link>`를 제거한다.
- 접근성: 시각적 순서 변경으로 키보드 탭 이동/포커스 순서가 어색해지지 않는지 확인하고, 필요 시 링크 구조를 보완한다(예: 썸네일 링크 제거/통합 등)
- 필요 시 `grid`(2-column)로 전환하여 레이아웃 안정성 확보

3. [x] 테스트
- Playwright: `tests/ui/visual-regression.spec.ts` 스크린샷 비교(`toHaveScreenshot`)
- 최소 뷰포트: 360 / 768 / 1440
- 스냅샷 갱신이 필요하면 `npm run test:ui:update`
- Playwright: 키보드 탭 이동으로 포커스 순서가 어색해지지 않는지(특히 카드 내 첫 포커스가 제목 링크인지) assertion 추가
- Playwright: 썸네일이 링크가 아닌지 assertion 추가

4. [ ] 문서화/정리
- [ ] 이슈 본문 체크리스트 업데이트(완료 표시)
- [x] 구현 중 발견된 결정사항을 `plans/implementation-plan.md`에 간단히 반영

## 리스크 및 확인 필요 사항
- 썸네일 비링크로 UX가 약간 변경될 수 있음(기존: 썸네일 링크 + 제목 링크 → 변경: 제목 링크만)
- 시각적 위치 변경이 탭 순서와 불일치하면 접근성/사용성 퇴행 위험
- 썸네일이 없는 카드와 있는 카드가 섞일 때의 정렬감(현재는 has/no-has 레이아웃이 다름)

## 검증 계획
- [x] `npm run test:all` (회귀 게이트)
- [ ] 빠른 반복 확인: `npm run test:ui:fast`
- [x] Playwright 스크린샷 테스트: `npm run test:ui` (360/768/1440)
- [x] (옵션) Playwright: 키보드 탭 이동 시 카드 내 첫 포커스가 제목 링크인지 assertion
