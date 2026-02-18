# ISSUE #81 style: 홈 섹션 분리 강화 및 아카이브 링크 문구 정리

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/81
- Issue 번호: 81
- 기준 브랜치: main
- 작업 브랜치: issue-81-style-home-sections
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-81-style-home-sections
- 작성일: 2026-02-18

## 배경/문제
- 홈(`/`) 하단의 3개 버튼(전체 아카이브/직접 작성만 보기/AI 수집만 보기)은 상단 내비/섹션 상단 링크와 기능이 중복되어 시각적 노이즈가 있다.
- `태그 허브` / `최신 직접 작성` / `최신 AI 수집` 섹션이 여백 위주로만 분리되어 스크롤 시 경계가 약하다.
- 섹션 제목 옆 링크 문구가 `전체 태그 보기` vs `직접 작성 아카이브`처럼 톤이 달라 일관성이 떨어진다.

## 목표
- [ ] 홈 하단의 3개 버튼 그룹이 제거된다.
- [ ] 하단 버튼 제거 이후에도 네비게이션 동선이 유지된다.
- [ ] `태그 허브` / `최신 직접 작성` / `최신 AI 수집` 섹션이 카드형 컨테이너로 통일되어 섹션 단위로 읽힌다.
- [ ] 섹션 헤더가 divider 포함 레이아웃/타이포로 통일되어 헤더/콘텐츠 경계가 명확하다.
- [ ] 섹션 제목 옆 링크 라벨이 `전체 ... 보기` 톤으로 일관된다.
- [ ] empty state 안내문에서 아카이브 링크 언급이 제거된다(하단 버튼 삭제 반영).
- [ ] `npm run test:ui` 통과 (필요 시 `npm run test:ui:update`로 스냅샷 갱신).

## 범위
### 포함
- `src/app/page.tsx` 하단 버튼 섹션 제거
- `src/app/page.tsx` 3개 섹션 컨테이너 스타일 통일(카드형 래핑)
  - `rounded-2xl border border-slate-200 bg-white p-6 shadow-sm` 계열
  - 섹션 헤더 divider(`border-b`) + padding으로 헤더/콘텐츠 경계 명확화
  - 섹션 카드 레이아웃(권장)
    - section wrapper(rounded/border/bg/shadow)
    - header: `flex` 정렬 + `border-b` + padding
    - body: 콘텐츠 영역 padding
- 섹션 제목 옆 링크 라벨 문구 변경
  - `전체 태그 보기` 유지
  - `직접 작성 아카이브` -> `전체 직접 작성 보기` (확정)
  - `AI 수집 아카이브` -> `전체 AI 수집 보기` (확정)
- empty state 문구 수정(하단 버튼 삭제에 맞춤)
  - 권장 문구(예시): `아직 글이 없습니다. 상단 메뉴(글 목록/태그)에서 탐색을 시작해 보세요.`
- UI 시각 회귀: Playwright 스냅샷 업데이트
  - `tests/ui/visual-regression.spec.ts` (뷰포트 360/768/1440 포함)

### 제외
- 홈(`/`) 외 페이지의 스타일/카피 일괄 정리
- 네비게이션 정보 구조 변경(상단 메뉴 구성 변경)
- 아카이브/태그 페이지의 기능/쿼리/정렬 변경

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

### 세부 작업
- [ ] `src/app/page.tsx`에서 홈 하단 버튼 그룹 렌더링 위치 확인 후 제거
- [ ] 섹션 카드형 컨테이너 공통화
  - [ ] 단순 래핑만으로 충분하면 `section`별 wrapper를 직접 적용
  - [ ] 중복이 크면 내부 전용 컴포넌트(예: `HomeSectionCard`)로 추출(단, 과도한 추상화는 지양)
  - [ ] `최신 AI 수집` 카드 구조(확정): `section` wrapper를 카드로 통일하고, 내부 리스트는 `divide-y`만 유지(rounded/border/shadow 제거)해 이중 border/shadow를 방지
- [ ] 섹션 헤더 통일
  - [ ] 제목 + 링크를 동일 레이아웃으로 정렬
  - [ ] 헤더 하단 divider 추가
- [ ] 섹션 제목 옆 링크 라벨 문구 변경(결정안 반영)
- [ ] 글이 없을 때(empty state) 안내문에서 아카이브 링크 언급 제거
- [ ] Playwright 시각 회귀 스냅샷 업데이트
  - [ ] `tests/ui/visual-regression.spec.ts` 실행 대상에 홈(`/`)이 포함되는지 확인
  - [ ] 필요 시 360/768/1440 스냅샷 갱신
- [ ] 문서화/정리: `docs/codebase.md`의 홈 CTA 설명(하단 버튼) 문구 정리
  - [ ] `docs/codebase.md`에서 `/` 설명의 `+ CTA`(하단 버튼) 언급을 삭제/수정

## 리스크 및 확인 필요 사항
- 카드 래핑/패딩 변경으로 인해 홈 레이아웃이 뷰포트별로 예상치 않게 밀릴 수 있음(특히 모바일에서 제목/링크 줄바꿈)
- 스냅샷 변경량이 커져 리뷰가 어려울 수 있으므로, 변경 범위를 홈(`/`)로 제한하고 불필요한 리플로우를 피해야 함
- `bg-white`/`border-slate-200` 사용 시 다른 테마(있다면)와 충돌 가능. 프로젝트의 기존 홈 배경/톤과의 정합성 확인 필요

## 영향 파일
- `src/app/page.tsx`
- `tests/ui/visual-regression.spec.ts`
- `tests/ui/visual-regression.spec.ts-snapshots/*` (스냅샷 업데이트 시)
- `docs/codebase.md` (CTA 설명 문구 정리 시)

## 완료 기준(DoD)
- [ ] 홈 하단 3개 버튼이 사라지고도 네비게이션 동선이 유지된다.
- [ ] 세 섹션이 시각적으로 분리되어 섹션 단위로 읽히며 스크롤 시 경계가 명확하다.
- [ ] 링크 라벨이 `전체 ... 보기` 톤으로 일관된다.
- [ ] `npm run test:ui` 통과
- [ ] PR 전 `npm run test:all` 통과

## 검증 계획
- [ ] Playwright: `npm run test:ui` 실행 후 홈(`/`) 스냅샷 갱신 및 통과 확인(360/768/1440)
- [ ] Playwright 기능 assertion
  - [ ] 홈(`/`)에서 하단 CTA(전체 아카이브/직접 작성만 보기/AI 수집만 보기)가 더 이상 존재하지 않음
  - [ ] 홈(`/`)에서 섹션 헤더 링크 라벨/대상 경로가 기대값과 일치
    - [ ] `전체 태그 보기` -> `/tags`
    - [ ] `전체 직접 작성 보기` -> `/posts?type=original`
    - [ ] `전체 AI 수집 보기` -> `/posts?type=ai`
  - [ ] empty state(글 0개)에서 안내문이 하단 CTA/아카이브 링크를 더 이상 언급하지 않음(필요 시 전용 스냅샷 추가)
- [ ] 기능 확인(Playwright assertion 권장, 수동 확인은 지양)
  - [ ] 홈(`/`) 하단에 버튼 그룹이 더 이상 존재하지 않음
  - [ ] 각 섹션 제목 옆 링크(전체 태그 보기/전체 직접 작성 보기/전체 AI 수집 보기)가 기대 경로로 이동
  - [ ] 상단 메뉴 `글 목록`으로 전체 글 접근 가능

## PR 리뷰 반영 내역 (2026-02-18)
- 코멘트: empty state 테스트에 스크린샷 비교 + axe 접근성 검사 추가
- 실제 변경:
  - `tests/ui/home-empty-state.spec.ts`: `toHaveScreenshot()` + `@axe-core/playwright`(serious/critical 0) + 애니메이션 비활성화 스타일 적용
  - `tests/ui/home-empty-state.spec.ts-snapshots/*`: 뷰포트별 스냅샷 추가(360/768/1440)
- 검증:
  - `PLAYWRIGHT_SKIP_BUILD=1 node scripts/test-ui.mjs tests/ui/home-empty-state.spec.ts` (mobile/tablet/desktop 모두 통과)
