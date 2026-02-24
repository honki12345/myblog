# ISSUE #126 로그인 상태 헤더 탭 순서 조정

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/126
- Issue 번호: 126
- 기준 브랜치: main
- 작업 브랜치: fix/header-tab-order
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/fix/header-tab-order
- 작성일: 2026-02-24

## 배경/문제
관리자 로그인 상태에서 헤더 내비게이션 탭 순서가 UX 기대와 다르게 노출된다.  
현재는 `글 목록 -> 위키 -> 글쓰기 -> 로그아웃` 순서이며, 요구사항은 `위키 -> 글 목록 -> 글쓰기 -> 로그아웃`이다.

## 목표
- [ ] 로그인 상태 헤더 탭 순서를 `위키 -> 글 목록 -> 글쓰기 -> 로그아웃`으로 조정
- [ ] 비로그인 상태 내비게이션 동작 및 기존 접근 제어 동작에 회귀가 없는지 검증

## 범위
### 포함
- `src/app/layout.tsx` 기준 로그인 상태 헤더 링크 렌더링 순서 수정
- `src/components/AdminAuthNavButton.tsx` 렌더링 구조(글쓰기 링크 + 로그아웃 버튼)와의 결합 영향 검토
- 필요 시 관련 컴포넌트(`src/components/HomeTitleLink.tsx`) 영향 검토
- 탭 순서 회귀 방지 테스트 보강(기존 테스트 확장 또는 신규 테스트)

### 제외
- 헤더 스타일/디자인 변경
- 인증 로직 자체 변경
- 탭 라벨 문구 변경

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리
5. [ ] `plans/use-cases.md` 유스케이스/Traceability Matrix 동기화

## 리스크 및 확인 필요 사항
- 로그인/비로그인 분기 조건에서 탭 표시 조건이 섞여 있을 경우 예상치 못한 순서 변화 가능
- UI 테스트가 순서를 직접 검증하지 않으면 동일 이슈 재발 가능
- 로그아웃은 링크가 아닌 버튼이므로 헤더 순서 검증 시 링크/버튼 혼합 순서(`a + button`)를 함께 확인해야 함

## 검증 계획
- [ ] Playwright E2E에서 로그인 상태 헤더 탭 순서(`위키 -> 글 목록 -> 글쓰기 -> 로그아웃`) assertion 추가/갱신
- [ ] `tests/ui/write-link-auth.spec.ts`에 `nav[aria-label="주요 메뉴"]`의 링크/버튼 순서 assertion(로그아웃 버튼 포함) 추가
- [ ] Playwright E2E에서 비로그인 상태 헤더 탭 노출 규칙(`위키`, `로그인` 노출 / `글 목록`, `글쓰기`, `로그아웃` 미노출) assertion 확인
- [ ] 헤더 포함 스냅샷(`tests/ui/*-snapshots`) diff 발생 시 순서 변경 의도와 비의도 회귀를 구분해 점검
- [ ] `npm run test:all` 실행으로 회귀 확인(프로젝트 규칙 준수)

### 테스트 시나리오(세부)
- [ ] 탭 순서 검증 범위는 헤더 `nav[aria-label="주요 메뉴"]` 내부 인터랙티브 항목으로 한정
- [ ] 로그인 상태(`/wiki`)에서 `nav[aria-label="주요 메뉴"]`의 인터랙티브 항목 텍스트 순서가 `위키`, `글 목록`, `글쓰기`, `로그아웃`인지 검증
- [ ] 비로그인 상태(`/wiki`)에서 헤더 항목 순서가 `위키`, `로그인`인지 검증하고 관리자 전용 항목 미노출을 확인
- [ ] 위 시나리오를 Playwright 프로젝트 `mobile-360`, `tablet-768`, `desktop-1440`에서 공통 실행

### 통과 기준
- [ ] 헤더 순서 assertion(로그인/비로그인)이 모두 통과
- [ ] 헤더 내비게이션 대상 axe `serious`/`critical` 위반 0건 유지
- [ ] 전체 회귀(`npm run test:all`) 통과
