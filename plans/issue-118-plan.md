# ISSUE #118 feat: 위키 상위경로 버튼에 목적지 경로 표시 UI 개선

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/118
- Issue 번호: 118
- 기준 브랜치: main
- 작업 브랜치: feat/issue-118-wiki-parent-path-target
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/feat/issue-118-wiki-parent-path-target
- 작성일: 2026-02-24

## 배경/문제
위키 상세 화면의 `상위경로` 버튼만으로는 사용자가 클릭 시 이동 목적지를 직관적으로 알기 어렵다. 특히 계층이 깊은 경로에서 탐색 맥락이 약해져 사용성이 저하된다.

## 목표
- [ ] 위키 상세의 `상위경로` 버튼에 부모 경로 정보(경로명/slug)를 함께 표시한다.
- [ ] 루트 직하위 경로에서도 상위 경로 버튼을 노출하고 목적지를 `/wiki`로 표시한다.
- [ ] 모바일/데스크톱에서 긴 경로명 처리(줄바꿈/ellipsis) 기준을 적용한다.
- [ ] Playwright UI 테스트(스크린샷 + 기능 assertion)로 회귀를 방지한다.

## 범위
### 포함
- `src/components/wiki/WikiExplorerClient.tsx`의 상위경로 버튼 텍스트/표시 로직 개선
- `/wiki`, `/wiki/[...path]`에서 상위경로 노출/비노출 동작 정리
- 관련 Playwright UI 테스트 추가 또는 갱신
- `tests/ui/wiki-view.spec.ts`에 상위 경로 버튼 텍스트/href/클릭 이동 assertion 추가
- 필요 시 `tests/ui/visual-regression.spec.ts`의 `/wiki/sample` 스냅샷 기준 이미지 갱신

### 제외
- 위키 트리 데이터 구조/DB 스키마 변경
- 댓글/태그 저장 API 계약 변경
- 상위경로 외 다른 네비게이션 컴포넌트 전면 개편

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
   - [ ] 상위 경로 버튼 라벨 형식을 `상위 경로 (/wiki/...)`로 통일
   - [ ] 루트 직하위 경로에서도 상위 경로 버튼을 활성 링크로 노출하고 `href=/wiki` 적용
3. [ ] 테스트
   - [ ] `npm run test:step11`로 댓글/위키 경로 집계 및 공개 노출 회귀 검증
   - [ ] `tests/ui/wiki-view.spec.ts`, `tests/ui/accessibility.spec.ts` 관련 케이스 갱신
4. [ ] 문서화/정리
   - [ ] 기능/테스트 변경사항을 `plans/use-cases.md` 유스케이스 명세 및 Traceability Matrix에 동기화

## 리스크 및 확인 필요 사항
- 긴 부모 경로 표시 시 버튼 레이아웃이 좁은 모바일 뷰포트에서 깨질 수 있음
- 스크린샷 테스트 안정화를 위해 고정 데이터/애니메이션 비활성화 조건을 점검해야 함
- 루트 직하위 경로 정책은 버튼 노출 + `/wiki` 활성 링크로 확정됨 (테스트와 일치 필요)

## 검증 계획
- [ ] 필요 시 유틸 함수(`getParentPath` 등) 단위 검증 추가
- [ ] Playwright 기능 assertion + 스크린샷 비교(뷰포트 360/768/1440)
- [ ] 접근성 검사(`@axe-core/playwright`) 회귀 확인
- [ ] 상위 경로 버튼 라벨이 `상위 경로 (/wiki/...)` 형식인지 assertion 검증
- [ ] 루트 직하위 경로에서도 상위 경로 버튼이 활성 링크로 노출되고 `href=/wiki`인지 검증
- [ ] `mobile-360`에서 긴 부모 경로 표시 시 오버플로우/레이아웃 깨짐 없음 검증(기능 assertion + 스냅샷)
- [ ] 스크린샷 기준 이미지와 CI 실행 환경(OS/브라우저 프로젝트) 일치로 환경 차이 기반 false positive 최소화
- [ ] PR 전 `npm run test:all` 실행 및 실패 시 수정 후 전체 재실행

## 완료 기준(Definition of Done)
- [ ] 상위 경로 버튼 라벨이 `상위 경로 (/wiki/...)` 형식으로 부모 목적지 경로를 일관되게 표시한다.
- [ ] 루트 직하위 경로에서도 상위 경로 버튼이 노출되고 `href=/wiki`가 문서와 테스트에 동일하게 반영된다.
- [ ] 360/768/1440 뷰포트에서 위키 상세 화면 수평 오버플로우가 발생하지 않는다.
- [ ] 관련 회귀 테스트(`test:step11`, UI 기능/시각, 접근성)가 모두 통과한다.
