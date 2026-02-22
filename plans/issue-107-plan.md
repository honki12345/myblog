# ISSUE #107 test: 테스트 실행 시간 단축을 위한 테스트 구조 개선

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/107
- Issue 번호: 107
- 기준 브랜치: main
- 작업 브랜치: issue-107-test
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-107-test
- 작성일: 2026-02-21

## 배경/문제
- `npm run test:all` 실측 10m 32s로 개발 피드백 루프가 느림
- 주요 병목은 UI 3뷰포트 직렬 실행(6m 13s)과 step별 `next dev` 반복 기동/초기 컴파일
- PR/로컬에서 빠르게 확인 가능한 최소 게이트와 main/nightly 전체 게이트 분리가 필요

## 목표
- [x] PR/로컬 기준 빠른 테스트 세트(`test:quick`)를 정의하고 스크립트/문서에 반영
- [x] 전체 품질 보장을 유지하면서 UI/서버 기동 테스트 구조를 재편해 총 실행 시간을 단축
- [x] 회귀 규칙 정합성 유지: 기능 변경/PR 전 `npm run test:all` 실행 규칙은 유지하고, 변경이 필요하면 `AGENTS.md`/`docs/codebase.md`를 동시 개정

## 범위
### 포함
- `test:quick` 스크립트 추가 및 운영 기준 문서화
- `test:quick` 초기 구성안 정의(예: `test:step1`, `test:step2`, `test:step3`, `test:step4`, `test:step5`, `test:step8`, `test:ui:fast`) 후 실측 결과로 조정
- UI 테스트를 기능/a11y와 시각 회귀로 분리, PR/로컬 빠른 게이트는 1뷰포트 중심으로 축소
- main/nightly 게이트에서는 시각 회귀 최소 뷰포트 `360/768/1440`을 유지
- `scripts/test-step-3.mjs`, `scripts/test-step-5.mjs`, `scripts/test-step-8.mjs`의 서버 재기동 횟수 축소
- API 계약 테스트의 `next dev` -> `standalone(node .next/standalone/server.js)` 전환 가능성 검증/PoC
- CI 게이트를 `PR(빠른 세트)` / `main·nightly(전체 세트)`로 분리
- 개선 전/후 실행 시간 비교 리포트 작성(총시간 + step별)

### 제외
- 기능 스펙 변경(블로그 동작 자체 변경)
- 테스트 커버리지 확장 자체를 목표로 한 신규 대규모 시나리오 추가

## 구현 단계
1. [x] 현행 스크립트/CI 병목 분석 및 측정 기준 고정
2. [x] 테스트 스크립트 구조 개편(`test:quick`, UI 분리, step 서버 기동 최적화)
   - 우선순위: 서버 재기동 병목이 큰 `scripts/test-step-3.mjs`, `scripts/test-step-8.mjs` 먼저 최적화하고 `scripts/test-step-5.mjs`는 재시도 안정성을 유지하는 범위에서 최소 변경
3. [x] API 계약 테스트 `standalone` 전환 PoC 및 리스크 평가
   - 준비 조건: `npm run build` 이후 `.next/standalone/server.js` 실행 기준으로 검증하고 `.next/static`, `public` 복사 전제를 명시
   - 실패 시 fallback: `next dev` 유지 + 원인/제약을 문서에 기록
   - 운영 결정: PoC 성공 기준 충족 시 `standalone`으로 즉시 채택, 미달 시 `next dev` 유지
4. [x] CI 워크플로우 게이트 분리(PR/main/nightly) 적용 + nightly 스케줄 트리거(cron) 명시(기본 브랜치 기준 동작 제약 포함)
   - 운영 결정: PR에서는 `test:quick`를 모든 PR에 필수 게이트로 강제
   - 운영 결정: nightly는 GitHub Actions hosted runner(`ubuntu-latest`)에서 실행
   - 운영 결정: nightly 전체 게이트는 매일 1회(UTC 고정 시각) 실행
5. [x] 전/후 성능 측정, 문서/유스케이스 트레이서빌리티 업데이트(`plans/use-cases.md`, `docs/codebase.md`, 필요 시 `AGENTS.md`)
   - 영향 파일: `scripts/test-step-3.mjs`, `scripts/test-step-5.mjs`, `scripts/test-step-8.mjs`, `scripts/test-all.mjs`, `scripts/test-ui.mjs`, `.github/workflows/ci.yml`(필요 시 nightly workflow 추가)
   - 보고 기준: 시간 단축 수치와 함께 실패율/flake 지표를 같이 기록

## 완료 기준(Definition of Done)
- [x] `test:quick`가 문서화된 구성으로 로컬/CI에서 재현 가능하게 동작
- [x] `test:quick` 실행 시간이 기존 `test:all` 기준 실측(10m 32s) 대비 단축됨(측정값 기록 필수)
- [x] `test:all` 실행 시간이 개선 전 대비 단축되거나 동일 시간에서 신뢰성(실패율/flake) 지표가 개선됨
- [x] PR 게이트(빠른 세트)와 main/nightly 게이트(전체 세트) 분리가 CI에서 확인됨
- [x] `plans/use-cases.md`, `docs/codebase.md`(필요 시 `AGENTS.md`) 동기화 완료

## 리스크 및 확인 필요 사항
- `standalone(node .next/standalone/server.js)` 기반 계약 테스트가 현재 테스트 더블/환경 변수 세팅과 충돌할 수 있음
- UI 스크린샷 안정화(애니메이션/타임존/시드 데이터)가 깨지면 flake가 늘어날 수 있음
- PR 게이트 축소 시 회귀 누락 가능성이 있어 main/nightly 전체 게이트 신뢰성 보강 필요

## 검증 계획
- [x] `npm run test:quick` 기준 시간/안정성 측정
- [x] `npm run test:all` 전/후 총시간 및 step별 시간 비교
- [x] Playwright 기능 assertion + 접근성 검사 + 시각 회귀(정의된 뷰포트 정책) 검증
- [x] CI에서 PR/main/nightly 게이트 동작 분리 확인
- [x] 게이트 역할 명시: PR 빠른 게이트(피드백 속도) vs main/nightly 전체 게이트(회귀 누락 방지) 포함 테스트 목록 문서화
- [x] flaky 지표 수집: 최근 N회 기준 재시도 발생률, snapshot diff 발생률 비교
- [x] `test:quick` 통과 후 `test:all`에서만 잡히는 회귀 발생 시 quick 세트 승격 규칙(승격 대상/기준/시점) 검증

## 실행 결과 (2026-02-21)

### 시간 비교

| 항목 | 개선 전 | 개선 후 | 변화 |
| --- | --- | --- | --- |
| `npm run test:all` 총 실행 시간 | 10m 32s | 5m 15s | 5m 17s 단축 (약 50.2%) |
| `npm run test:quick` 총 실행 시간 | - | 4m 11s | 신규 빠른 게이트 |

### 개선 후 `test:all` step별 실측

| 구간 | 시간 |
| --- | --- |
| `step1` | 1m 14s |
| `step2+step4` 병렬 | 0m 4s |
| `step3` | 0m 2s |
| `step5` | 0m 40s |
| `step8` | 0m 2s |
| `step9` | 0m 12s |
| `step10` | 0m 17s |
| `step11` | 0m 11s |
| `ui:functional (desktop-1440)` | 1m 43s |
| `ui:visual (360/768/1440)` | 0m 49s |

### PoC 결정 기록

- `step3`, `step8`: standalone(`node .next/standalone/server.js`) 자동 전환 채택(`auto`)
- `step5`: standalone 모드에서 malformed slug 상태코드 회귀(계약 불일치) 확인, 기본 모드를 `dev`로 fallback 유지

### 안정성/flake 관찰 (로컬 샘플)

- 샘플: 최종 검증 1회(`test:quick`, `test:all`)
- 재시도 발생률: 0/1
- snapshot diff 발생률: 0/1
