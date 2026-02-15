# ISSUE #22 fix: /write 프리뷰에 markdown typography 스타일이 적용되지 않음

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/22
- Issue 번호: 22
- 기준 브랜치: main
- 작업 브랜치: issue-22-fix-write-markdown-typography
- Worktree 경로: .../.worktrees/issue-22-fix-write-markdown-typography
- 작성일: 2026-02-15

## 배경/문제
`/write` 실시간 프리뷰에서 `#` 헤딩, 리스트, 코드블록 등 마크다운 요소가 typography 스타일 없이 평문처럼 렌더링된다. Playwright 측정에서도 `h1`과 `p`의 폰트 크기/굵기가 동일(`16px`, `400`)하며, 빌드 CSS에서 `.prose` 관련 규칙이 탐지되지 않아 스타일 적용 경로 누락 가능성이 있다.

## 목표
- [ ] `/write` 프리뷰에서 마크다운 typography 스타일이 정상 적용되도록 수정
- [ ] 동일 회귀를 방지할 테스트를 추가

## 범위
### 포함
- `/write` 프리뷰 스타일 적용 경로(Tailwind Typography 설정/클래스 적용) 점검 및 수정
- `/write` 프리뷰 전용 `markdown-preview` 커스텀 스타일(헤딩/리스트/코드블록) 정의 및 컨테이너 클래스 적용 여부 점검
- 헤딩/리스트/코드블록 렌더링 검증 테스트 보강

### 제외
- `/write` 외 다른 페이지의 전면 스타일 리디자인
- 마크다운 파서/렌더러 전면 교체

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

### 결정 사항(확정)
- [ ] Typography 적용 정책: `/write` 프리뷰 전용 `markdown-preview` 커스텀 스타일로 적용
- [ ] 테스트 배치 정책: `tests/ui/write-typography.spec.ts` 신설

### 완료 기준(DoD)
- [ ] `src/app/globals.css`에 `/write` 프리뷰 전용 `markdown-preview` 스타일 규칙 적용 완료
- [ ] `/write` 프리뷰에서 `h1`과 `p`의 computed style(`font-size`, `font-weight`) 차이 확인
- [ ] 리스트/코드블록 스타일 적용 확인
- [ ] 신규 테스트 및 기존 `write` E2E/visual/accessibility 포함 `npm run test:all` 통과

### 세부 작업
- [ ] `src/app/globals.css`에 `/write` 프리뷰 전용 `markdown-preview` 스타일 규칙(`h1`, `ul`, `pre` 등) 정의
- [ ] `src/app/write/page.tsx` 프리뷰 컨테이너 클래스를 `markdown-preview`로 교체
- [ ] `tests/ui/write-typography.spec.ts` 신설 후 `h1`/`p` computed style 차이, 리스트/코드블록 스타일 적용 assertion 추가

## 리스크 및 확인 필요 사항
- `/write` 프리뷰 전용 커스텀 스타일 규칙이 과도하면 실제 포스트 상세 페이지와 시각적 일관성이 어긋날 수 있음
- 커스텀 스타일 변경 시 모바일/태블릿/데스크톱에서 줄바꿈/간격 회귀 여부 확인 필요

## 검증 계획
- [ ] Playwright 시각 회귀 테스트 보강(`toHaveScreenshot`, 뷰포트 `360/768/1440`)
- [ ] 기능 assertion 추가(`h1`/`p` 스타일 차이, 리스트/코드블록 스타일 적용 확인)
- [ ] 접근성 검사 추가(`@axe-core/playwright`)
- [ ] Playwright에서 프리뷰 입력 마크다운(`# 제목\n\n본문\n\n- 항목\n\n```js\nconsole.log(1)\n```)에 대해 `h1`/`p` computed style(`font-size`/`font-weight`) 차이 assertion
- [ ] Playwright에서 리스트/코드블록의 주요 스타일(`list-style-type`, `pre` 배경/패딩) assertion
- [ ] `tests/ui/write-typography.spec.ts`에서 typography 전용 assertion 수행
- [ ] (선택) 빌드 후 CSS 산출물에 Typography 관련 규칙 존재 여부 점검(스모크)
- [ ] 테스트 데이터/환경 고정: 기존 Playwright 설정(`locale/timezone/reduced motion`) 준수
- [ ] 통과 기준: 신규 assertion 전부 통과 + 기존 `write` E2E/visual/accessibility 스펙 회귀 없음
- [ ] PR 전 `npm run test:all` 실행 및 실패 시 수정 후 전체 재실행

## PR 리뷰 반영 내역 (2026-02-15)
- 코멘트 ID: 2809371257 (Copilot)
  - 요약: `write-e2e`와 `write-typography`의 API Key 인증 로직 중복 제거
  - 실제 변경: `tests/ui/helpers.ts`에 `authenticateWriteEditor()` 공용 헬퍼 추가, `tests/ui/write-e2e.spec.ts`/`tests/ui/write-typography.spec.ts`에서 재사용
  - 검증: `npx playwright test tests/ui/write-e2e.spec.ts` 통과 (12 passed), `npm run test:all` 통과
  - 후속 작업: 없음
- 코멘트 ID: 2809371291 (Copilot)
  - 요약: 계획 문서의 로컬 절대 경로 제거
  - 실제 변경: `plans/issue-22-plan.md`의 Worktree 경로를 `.../.worktrees/issue-22-fix-write-markdown-typography`로 일반화
  - 검증: 문서 변경 확인 완료
  - 후속 작업: 없음
- 코멘트 ID: 2809371309 (Copilot)
  - 요약: Playwright 웹서버 커맨드 fail-fast 보장
  - 실제 변경: `playwright.config.ts`의 `PLAYWRIGHT_WEB_SERVER_COMMAND`에 `set -eu` 추가, `.worktrees` 디렉터리 유무 가드 추가
  - 검증: `npx playwright test tests/ui/write-e2e.spec.ts` 통과, `npx playwright test tests/ui/write-typography.spec.ts` 통과, `npm run test:all` 통과
  - 후속 작업: 없음
- 코멘트 ID: 2809378736 (CodeRabbit)
  - 요약: typography 테스트에 시각 회귀/접근성 검사 추가
  - 실제 변경: `tests/ui/write-typography.spec.ts`에 `toHaveScreenshot("write-preview-typography.png")` 및 `AxeBuilder` 기반 serious/critical 위반 검사 추가, 스냅샷 파일 생성
  - 검증: `npx playwright test tests/ui/write-typography.spec.ts` 통과 (3 passed), `npm run test:all` 통과
  - 후속 작업: 없음
