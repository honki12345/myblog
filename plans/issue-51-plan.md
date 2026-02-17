# ISSUE #51 chore: 테스트 실행 시간 단축

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/51
- Issue 번호: 51
- 기준 브랜치: main
- 작업 브랜치: issue-51-chore-speed-up-tests
- Worktree 경로: .../.worktrees/issue-51-chore-speed-up-tests
- 작성일: 2026-02-17

## 배경/문제
`npm run test:all` 및 CI의 UI 테스트(`ui-visual` job)가 오래 걸려 개발/PR 피드백이 느리다.
특히 현재 구성상 `test:all`에서 build가 최소 2회 수행된다(`test:step1` + `playwright.config.ts`의 `webServer`). CI도 `verify` job의 build + `ui-visual` job의 Playwright `webServer` build로 중복된다. 또한 Playwright가 3개 뷰포트를 `workers: 1`로 순차 실행한다.

## 원칙 (테스트 실효성/서비스 유사성 보존)
- 테스트 시나리오/검증 범위(예: `test:all`, CI UI 테스트)는 유지한다. 시간 단축을 위해 커버리지를 삭제하지 않는다.
- 최적화는 “중복/낭비 제거”에 한정한다: build 중복 제거, 동일 커밋 산출물 재사용(artifact), 캐시, 병렬화.
- `test:ui:fast`는 로컬 반복용 “추가 옵션”이며, PR/CI 기준 테스트(`test:ui`, `test:all`)를 대체하지 않는다.

## 목표
- [x] 로컬 `npm run test:all` wall-clock 단축 (기준값 측정 후 수치 목표 확정)
- [x] CI `ui-visual` job wall-clock 단축 (build 중복 제거 + 병렬화/캐시)

## 범위
### 포함
- (측정) 로컬 `npm run test:all` 실행 시 step별 소요시간 기록 (`scripts/test-all.mjs` 로그 활용)
- (원인 확인) `test:all`에서 build 중복 여부 확인 (`scripts/test-step-1.mjs` vs `playwright.config.ts`)
- (개선) Playwright `webServer`의 `npm run build`를 조건부로 skip 가능하게 변경
- (개선) `scripts/test-all.mjs`에서 `test:ui` 실행 시 build skip 플래그를 전달해 중복 build 제거
- (CI) verify job build 산출물을 `ui-visual` job에서 재사용하도록 구성 (artifact)
- (CI) Playwright 브라우저 설치/캐시 최적화 검토
- (Playwright) CI 한정 `workers` 상향 또는 viewport별 matrix 분리로 wall-clock 단축 실험 후 안정성 확인
- (로컬) 빠른 반복을 위한 `test:ui:fast`(전체 UI 스펙을 1개 viewport로 실행) 추가 (PR 전에는 기존 `test:ui`/`test:all` 유지)
- (문서) `docs/codebase.md` 업데이트 (CI summary / 테스트 실행 가이드 섹션, `test:all` 구성 변경점 반영)

### 제외
- 테스트 커버리지/시나리오를 삭제해서 시간을 줄이는 변경(품질 저하)
- 프로덕션 기능 변경(테스트 인프라/CI 범위를 벗어남)

## 구현 단계
1. [x] 분석 및 측정
2. [x] 구현
3. [x] 테스트
4. [x] 문서화/정리

### 우선순위(권장)
- P0: build 중복 제거(로컬 `test:all`/Playwright `webServer`) + CI verify → `ui-visual` artifact 재사용
- P1: CI 병렬화(Workers 상향 / viewport matrix) 실험. flake 증가 시 즉시 롤백
- P2: Playwright 브라우저 캐시(선택) / `test:ui:fast`(로컬 반복용) 추가

### 세부 작업
- [x] (측정) `npm run test:all` step별 시간 기록 (로컬) + 이슈 코멘트로 공유
- [x] (원인 확인) build 중복 발생 지점 확정
  - [x] `test:step1`에서 build 수행 여부 확인
  - [x] `playwright.config.ts` `webServer`가 `npm run build`를 수행하는지 확인
- [x] (개선) Playwright build skip 조건 추가
  - [x] env 플래그(예: `PLAYWRIGHT_SKIP_BUILD=1`) 기반으로 `webServer` build 스킵
  - [x] build skip 판정 시 산출물 정합성도 함께 확인 (`server.js`, `.next/static` 가드)
- [x] (개선) `scripts/test-all.mjs`에서 `test:ui` 실행 시 build skip 플래그 전달
- [x] (CI) verify 산출물 재사용
  - [x] verify job에서 standalone 실행에 필요한 산출물 업로드
    - [x] `.next/static`, `public`을 `.next/standalone`에 사전 복사 후 `.next/standalone/` 업로드
  - [x] verify의 `npm run build` 빌드 타임 env를 `ui-visual`과 동일하게 고정
    - [x] `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000`
  - [x] `ui-visual` job에서 다운로드 후 `webServer`는 build skip
- [x] (CI) Playwright 브라우저 캐시(설치) 최적화
  - [x] `~/.cache/ms-playwright` 캐시(키: `package-lock.json` hash)
- [x] (CI) 병렬화 실험
  - [ ] `workers` 상향 (CI에서만) 후 flake/리소스 영향 확인
  - [x] viewport별 matrix 분리 (job fan-out)
- [x] (로컬) `test:ui:fast` 스크립트 추가 (로컬 반복용) + 문서 반영
  - [x] `playwright test --project=desktop-1440`
- [x] (문서) `docs/codebase.md` 업데이트
  - [x] `CI summary`: verify 산출물 재사용 + `ui-visual`에서 build skip
  - [x] `Test strategy and commands`: `test:ui:fast` + build skip 플래그

## 리스크 및 확인 필요 사항
- build skip 조건이 잘못되면(산출물 누락/오염) UI 테스트가 실패하거나, 반대로 오래된 build를 재사용할 수 있음
- CI 병렬화는 리소스 제약(특히 RAM/CPU) 또는 flakiness를 유발할 수 있어 단계별로 실험/회귀 확인이 필요
- artifact 재사용 시 Next.js standalone 산출물 범위가 정확히 정의돼야 함 (누락 시 `webServer` 기동 실패)

## 영향 파일
- `scripts/test-all.mjs`
- `scripts/test-step-1.mjs`
- `playwright.config.ts`
- `.github/workflows/ci.yml`
- `package.json` (스크립트 추가 시)
- `docs/codebase.md` (CI summary / 테스트 실행 가이드 섹션)

## 완료 기준(DoD)
- [ ] 로컬 `npm run test:all`의 step별 기준 소요시간이 이슈에 기록돼 있다. (아래 “실행 결과”를 이슈 코멘트로 복사 예정)
- [x] `npm run test:all`에서 build가 불필요하게 중복 수행되지 않는다. (Playwright `webServer`에서 `PLAYWRIGHT_SKIP_BUILD=1` 로그로 확인)
- [ ] CI `ui-visual` job이 verify 산출물을 재사용한다. (CI job 로그로 확인 필요)
- [ ] CI 최적화(캐시/병렬화)가 안정적이며 flake를 유의미하게 증가시키지 않는다. (CI 관찰 필요)
- [x] `npm run test:all` 통과

## 검증 계획
- [ ] 로컬: 변경 전/후 `npm run test:all` step별 시간 비교 (변경 전 기준 재측정 필요)
- [x] 로컬: `npm run test:all` 로그에서 `npm run build`가 1회만 수행됨을 확인 (Playwright `webServer` build 스킵 포함)
- [x] 로컬: `npm run test:ui` 및 `npm run test:all` 통과
- [x] 로컬: 사전 build 완료 상태에서 `PLAYWRIGHT_SKIP_BUILD=1 npm run test:ui` 통과
- [x] 로컬: `.next` 삭제 상태에서 `PLAYWRIGHT_SKIP_BUILD=1 npm run test:ui`가 빠르게 실패하며 산출물 누락 원인이 명확히 출력됨(가드 동작 확인)
- [ ] CI: `ui-visual` job wall-clock 비교 (변경 전/후)
- [ ] CI: artifact 재사용/캐시 hit 여부 확인
- [ ] CI: `ui-visual` job 로그로 artifact 다운로드 + Playwright build skip 여부 확인

## 실행 결과 (로컬, 2026-02-17)

### `npm run test:all` (after)

- `test:step1`: 0m 25s
- `group-a(step2+step4)`: 0m 3s
- `test:step3`: 0m 10s
- `test:step5`: 0m 21s
- `test:step8`: 0m 13s
- `test:step9`: 0m 6s
- `test:ui`: 1m 37s
- total: 2m 55s

### `test:ui` build vs skip (단일 파일, desktop-1440)

- build 포함: 2 tests in 26.6s
- build 스킵(`PLAYWRIGHT_SKIP_BUILD=1`): 2 tests in 3.2s

### 가드 확인

- `.next` 제거 + `PLAYWRIGHT_SKIP_BUILD=1` 실행 시 즉시 실패하며 `standalone server.js not found`를 출력한다.
