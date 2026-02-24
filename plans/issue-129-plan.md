# ISSUE #129 feat: 위키 댓글 메타 영역 레이아웃 정렬 개선

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/129
- Issue 번호: 129
- 기준 브랜치: main
- 작업 브랜치: feat/wiki-comment-meta-layout
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/feat/wiki-comment-meta-layout
- 작성일: 2026-02-24

## 배경/문제
위키 문서 상세의 연결된 댓글 카드 메타 영역에서 정보 배치 우선순위가 어색합니다.
현재 태그와 업데이트 정보가 같은 줄에 붙어 있고, 블로그 제목이 하단 링크 줄에 있어 정보 스캔성이 떨어집니다.

## 목표
- [ ] 댓글 메타 상단 행을 `왼쪽: 태그 + 블로그 제목`, `오른쪽: 업데이트` 구조로 재배치
- [ ] 상단 블로그 제목을 기존보다 강조된 타이포그래피로 표시

## 범위
### 포함
- 연결된 댓글 카드 메타 레이아웃 구조 변경
- 블로그 제목 위치/강조 스타일 조정
- 하단 링크 영역의 제목 제거 및 링크 구성 정리
- 변경 대상: `src/components/wiki/WikiExplorerClient.tsx` 내 위키 경로 상세/검색 결과 댓글 카드 메타 영역
- 적용 범위 확정: 위키 경로 상세 카드와 검색 결과 카드 모두에 동일 메타 정렬 규칙 적용
- 360/768/1440 뷰포트에서 줄바꿈/정렬 회귀 확인

### 제외
- 위키 댓글 카드 외 페이지의 전반적인 디자인 리뉴얼
- 댓글 데이터 스키마/백엔드 API 변경

## 구현 단계
1. [ ] 분석 및 재현
   - [ ] `src/components/wiki/WikiExplorerClient.tsx`의 위키 상세 카드/검색 결과 카드 메타 DOM 구조 확인
   - [ ] 현재 레이아웃 기준 스냅샷(`wiki-index`, `wiki-path`)과 문제 구간 기록
2. [ ] 구현
   - [ ] 상단 메타를 `왼쪽(tag + postTitle) / 오른쪽(updatedAt)` 2열 구조로 재배치
   - [ ] 하단 링크 영역에서 제목 텍스트를 제거하고 링크(`블로그 글 보기`, `원문 링크`)만 정리
   - [ ] 링크가 하나도 없으면 하단 링크 행을 렌더링하지 않도록 조건 분기 적용
   - [ ] 모바일 360 기준 줄바꿈 정책(`min-w-0`, `flex-wrap`, `break-words/truncate`) 적용
   - [ ] 동일 정책을 위키 상세 카드/검색 결과 카드 양쪽에 일관 적용
3. [ ] 테스트
   - [ ] `tests/ui/wiki-view.spec.ts` 기능 assertion 업데이트(상단/하단 정보 배치, 관리자 링크 노출 정책)
   - [ ] `tests/ui/wiki-view.spec.ts`, `tests/ui/visual-regression.spec.ts` 스냅샷 기준 업데이트(360/768/1440)
   - [ ] `npm run test:ui:functional` -> `npm run test:ui:visual` -> `npm run test:all` 순서로 회귀 실행
4. [ ] 문서화/정리 (`plans/use-cases.md` 유스케이스/Traceability Matrix 반영 포함)
   - [ ] 위키 댓글 카드 메타 레이아웃 변경에 대한 UC-WIKI-002 관련 수용 기준/테스트 매핑 동기화

## 리스크 및 확인 필요 사항
- 긴 블로그 제목/태그 조합에서 모바일 줄바꿈이 깨질 수 있음
- 관리자 세션 전용 링크 노출 조건이 레이아웃 변경 중 회귀할 수 있음

## 검증 계획
- [ ] 단위/통합 테스트로 카드 메타 렌더 분기(제목/태그/업데이트/링크) 회귀 방지
- [ ] Playwright 기능 assertion으로 위키 상세/검색 결과 댓글 카드 모두에서 상단 메타 정렬(태그/제목/업데이트)과 하단 링크 구성 검증
- [ ] 긴 제목(60자+) + 긴 태그 경로 seed 데이터로 360/768/1440 뷰포트 줄바꿈/오버플로우 회귀 검증
- [ ] 관리자/비관리자 세션별 `블로그 글 보기` 링크 노출 조건 회귀 검증(레이아웃 변경 후 정책 유지)
- [ ] Playwright 스크린샷 비교(`toHaveScreenshot`)로 360/768/1440 뷰포트 레이아웃 회귀 검증
- [ ] `@axe-core/playwright` 접근성 검사로 레이아웃 변경 후 기본 a11y 회귀 확인
- [ ] 회귀 테스트 파일 범위 반영: `tests/ui/wiki-view.spec.ts`, `tests/ui/visual-regression.spec.ts` 및 위키 스냅샷 베이스라인
- [ ] UI 회귀 실행 순서: `npm run test:ui:functional` -> `npm run test:ui:visual`, 최종 게이트로 `npm run test:all` 재실행
- [ ] 기능 변경 PR 전 `npm run test:all` 실행 및 실패 시 수정 후 전체 재실행
