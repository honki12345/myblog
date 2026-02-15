# Step 6 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-15
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`, `plans/step5-plan.md`

---

### Step 6: GitHub Actions CI/CD

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 6-1 | 배포 트리거 | `push to main` + 경로 필터 (`src/**`, `package*.json`, `next.config.*`) + `workflow_dispatch` | 문서 변경 시 불필요한 배포 방지 + 긴급 수동 배포 가능 |
| 6-2 | 네이티브 빌드 | 동일 아키텍처 의존 (ubuntu-latest x86_64) | GitHub Actions와 Oracle VM 모두 x86_64 Linux로 정렬해 호환 가능성을 높인다. 단, `better-sqlite3`는 환경에 따라 소스 빌드 fallback 가능성이 있어 Gate에서 `.node` 바인딩을 필수 확인 |
| 6-3 | 아티팩트 전송 | SCP/SSH 직접 전송 (`tar.gz` → `scp` → `ssh systemctl restart`) | 가장 단순. 개인 프로젝트에 rsync 최적화 불필요 |

> **의존성 영향**: 전송 방식(SSH) → Step 7 방화벽 규칙 / 빌드 환경 → Step 7 바이너리 호환성

#### 선행 조건 (Preflight)

- 워크플로우 파일 준비:
  - `.github/workflows/deploy.yml` 신규 생성
  - 기존 `.github/workflows/ci.yml`와 트리거 충돌(브랜치/경로/실행 목적) 점검
- 스크립트 준비:
  - `scripts/test-step-6.mjs` placeholder를 Gate 검증 로직으로 교체
  - `test:all` 기본 범위는 Step 5 기준(`step1~5 + ui`)으로 유지하고, Step 6은 `test:step6`로 분리 운영
- npm 스크립트 정렬:
  - `package.json`에 `"test:step6": "node scripts/test-step-6.mjs"` 추가
  - Step 6 변경 PR 전 실행 순서를 `npm run test:step6` → `npm run test:all`로 고정
- Step 6 영향 파일:
  - `.github/workflows/deploy.yml`
  - `.github/workflows/ci.yml`
  - `scripts/test-step-6.mjs`
  - `package.json`, `package-lock.json`

#### 구현 착수 체크포인트

- `.github/workflows/deploy.yml`이 없는 현재 상태를 기준으로 신규 배포 워크플로우를 먼저 작성한다.
- `scripts/test-step-6.mjs`의 placeholder(`console.log`)를 Gate Criteria 자동 검증 코드로 교체한다.
- `package.json`에 `test:step6` 스크립트를 추가해 문서의 자동화 실행 절차(`npm run test:step6`)를 실제 실행 가능 상태로 맞춘다.
- Step 6 변경 후 기존 `ci.yml`과 중복 실행/불필요 실행(문서 전용 커밋 등)을 방지하도록 트리거를 검증한다.

#### 운영 확정값 (관점 5 반영)

- 배포 성공은 `deploy.yml` 워크플로우 `success`와 원격 `/api/health` `200`을 모두 만족해야 한다.
- 배포 직후 `systemctl is-active blog != active` 또는 헬스체크 실패 시 즉시 롤백 절차를 실행한다.
- `deploy.yml`은 경로 필터를 적용해 문서 전용 변경에서 불필요한 배포를 유발하지 않도록 유지한다.
- 배포 Runbook에 마지막 성공 `run-id`, 배포 시각, 적용 릴리즈 경로를 기록한다.
- Runbook 기록 형식은 `docs/runbooks/deploy-log.md`에 `run-id | deployed-at(UTC/KST) | release-path | result`를 1행 append로 고정한다.

#### 실행 전 확정 질의 (관점 6 반영)

- `deploy.yml` 자동 트리거 범위는 `main` push + 경로 필터(`src/**`, `package*.json`, `next.config.*`)를 사용한다.
- 긴급/검증 목적 수동 배포를 위해 `workflow_dispatch`를 함께 유지한다.
- `.github/workflows/ci.yml`는 `검증 전용`, `deploy.yml`은 `배포 전용`으로 분리 운영한다.
- 롤백 대상 릴리즈 식별 규칙은 Step 7 전략과 동일하게 최신 성공 릴리즈의 직전 버전(`/opt/blog-v{N-1}`)으로 고정한다.
- 배포 스모크 실패 시 즉시 롤백한다. (재시도 없음)
- `BLOG_DOMAIN`, `VM_HOST`, `VM_USER`, `VM_SSH_KEY`는 모두 GitHub Secrets에 저장한다.
- 릴리즈 번호(`N`) 산정 규칙은 UTC 타임스탬프(`YYYYMMDDHHmmss`)를 기본값으로 사용한다. (선택지: `run_number` / `UTC 타임스탬프` / 수동 입력)
- `scripts/test-step-6.mjs`의 Secrets fail-fast는 키 존재 + 비어있지 않음 검증을 기본값으로 사용한다. (선택지: 키 존재만 / 키 존재+비어있지 않음)
- Runbook 기록 파일(`docs/runbooks/deploy-log.md`) 생성은 Step 6 범위에 포함한다. (선택지: Step 6 생성 / Step 7 생성)
- `workflow_dispatch` dry-run(테스트 7)은 Step 6 Gate 필수 항목으로 간주한다. (선택지: Gate 필수 / 선택 운영 점검)

#### 구현 내용

**6-1. 빌드 워크플로우 (`.github/workflows/deploy.yml`)**

```yaml
name: Build & Deploy
on:
  push:
    branches: [main]
    paths:
      - "src/**"
      - "package*.json"
      - "next.config.*"
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Package standalone
        run: |
          tar -czf blog-standalone.tar.gz \
            .next/standalone/ \
            .next/static/ \
            public/
      - name: Deploy to VM
        # scp or rsync로 VM에 전송
        # ssh로 systemctl restart blog
```

> `Deploy to VM` 필수 단계 체크리스트:
> 1) `blog-standalone.tar.gz`를 VM 임시 경로(`/tmp`)로 업로드  
> 2) 원격에서 신규 릴리즈 경로(`/opt/blog-v{N}/`) 생성 후 압축 해제  
> 3) `/opt/blog` symlink를 신규 릴리즈로 전환  
> 4) `sudo systemctl restart blog` 후 `is-active` 확인  
> 5) `https://$BLOG_DOMAIN/api/health` 실패 시 `/opt/blog-v{N-1}`로 즉시 롤백

**6-2. 배포 시크릿 (GitHub Secrets)**

| Secret | 용도 |
|--------|------|
| `BLOG_DOMAIN` | 배포 후 헬스체크 대상 도메인 |
| `VM_HOST` | Oracle VM 공인 IP |
| `VM_USER` | SSH 사용자명 (blog) |
| `VM_SSH_KEY` | SSH 개인키 |

#### 통과 기준 (Gate Criteria)

- GitHub Actions 워크플로우가 성공적으로 빌드 완료된다.
- standalone 아티팩트(`blog-standalone.tar.gz`)가 생성되고 필요한 파일이 모두 포함된다.
- 아티팩트의 `server.js`가 별도 환경에서 실행 가능하다.

#### 자동화 실행

```bash
npm run test:step6
npm run test:all
```

> `test:all`은 Step 5 정책(`step1~5 + ui`)을 유지하고, Step 6은 별도 `test:step6`로 검증한다.
> Step 2 이후 회귀 규칙에 따라 Step 6 관련 변경 PR 전에는 `test:step6`과 `test:all`을 모두 통과해야 한다.

> `scripts/test-step-6.mjs` — 클린 빌드, 아티팩트 패키징, 무결성 검증(별도 디렉토리 실행), 네이티브 바인딩 존재, 워크플로우 문법을 자동 실행.
> `scripts/test-step-6.mjs`는 워크플로우 정책 검증(`push.main`, `paths`, `workflow_dispatch`)과 CI/Deploy 분리(`ci.yml`에 배포 단계 미포함), 필수 Secrets 키 존재 여부(`BLOG_DOMAIN`, `VM_HOST`, `VM_USER`, `VM_SSH_KEY`)의 fail-fast 검증을 포함한다.
> 테스트 6~8은 CI/CD 파이프라인/원격 서버 상태를 포함하므로 자동 검증과 수동 확인을 분리해 운영한다.

#### 자동 검증 vs 수동 확인 경계

- 자동 검증 (`scripts/test-step-6.mjs`):
  - 로컬 클린 빌드, standalone 패키징, 아티팩트 무결성, 네이티브 바인딩, 워크플로우 구조 검사
  - `deploy.yml` 트리거 정책(`push.main`/`paths`/`workflow_dispatch`) 구조 검사
  - `ci.yml`(검증 전용)과 `deploy.yml`(배포 전용) 역할 분리 검사
  - 필수 Secrets 키 누락 fail-fast 검사
- 수동 확인 (`gh` + 원격 서버):
  - GitHub Actions 런 결과/로그 확인
  - `workflow_dispatch` 배포 dry-run 실행 및 단계별 로그 확인
  - 원격 서버 배포 후 `systemctl`/`/api/health` 스모크 확인, 실패 시 즉시 롤백

#### 테스트 목록

1. **로컬 빌드 시뮬레이션 (CI 환경 재현)**
   ```bash
   rm -rf node_modules .next
   npm ci
   npm run build
   echo $?
   ```
   - 기대 결과: 종료 코드 `0`, 클린 환경에서 빌드 성공

2. **standalone 아티팩트 패키징**
   ```bash
   tar -czf /tmp/blog-standalone.tar.gz \
     .next/standalone/ \
     .next/static/ \
     public/
   tar -tzf /tmp/blog-standalone.tar.gz | head -20
   ls -lh /tmp/blog-standalone.tar.gz
   ```
   - 기대 결과: `tar.gz` 파일 생성, 내부에 `server.js`, `static/`, `public/` 존재

3. **아티팩트 무결성 — 별도 디렉토리에서 실행**
   ```bash
   mkdir -p /tmp/blog-test && cd /tmp/blog-test
   tar -xzf /tmp/blog-standalone.tar.gz
   cp -r .next/static .next/standalone/.next/static 2>/dev/null || true
   cp -r public .next/standalone/public 2>/dev/null || true

   cd .next/standalone
   PORT=3002 node server.js &
   sleep 3
   CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002)
   echo "Response: $CODE"
   kill %1

   if [ "$CODE" = "200" ]; then
     echo "ARTIFACT INTEGRITY TEST PASSED"
   else
     echo "ARTIFACT INTEGRITY TEST FAILED"
   fi
   rm -rf /tmp/blog-test
   ```

4. **better-sqlite3 네이티브 바인딩 호환성**
   ```bash
   node -e "console.log(process.platform, process.arch)"
   ls .next/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node
   ```
   - 기대 결과: `linux x64`, `.node` 바인딩 파일 존재

5. **GitHub Actions 워크플로우 파일 문법 검증**
   ```bash
   node -e "
     const fs = require('fs');
     const yaml = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
     if (yaml.includes('on:') && yaml.includes('jobs:') && yaml.includes('npm run build')) {
       console.log('WORKFLOW SYNTAX OK');
     } else {
       console.error('WORKFLOW STRUCTURE INVALID');
       process.exit(1);
     }
   "
   ```

6. **GitHub Actions 실제 실행 확인 (push 후)**
   ```bash
   gh run list --limit 1
   gh run view <run-id>
   ```
   - 기대 결과: 워크플로우 `completed`, 결론 `success`

7. **`workflow_dispatch` 배포 dry-run 확인**
   ```bash
   gh workflow run deploy.yml --ref main
   gh run list --workflow deploy.yml --limit 1
   gh run view <run-id> --log
   ```
   - 전제 조건: `deploy.yml`이 기본 브랜치(`main`)에 존재해야 수동 트리거가 가능하다.
   - 기대 결과: 수동 트리거된 배포 파이프라인이 정상 완료되고, 아티팩트 생성/전송 단계 로그가 확인됨

8. **원격 배포 스모크 테스트 (SSH 전송 + 재기동 + 헬스체크)**
   ```bash
   ssh "$VM_USER@$VM_HOST" "sudo systemctl restart blog && sudo systemctl is-active blog"
   curl -fsS "https://$BLOG_DOMAIN/api/health"
   ```
   - 기대 결과: `systemctl is-active` 결과가 `active`, `/api/health`가 200 응답

9. **배포 실패 시 롤백 검증 (스모크 실패 조건)**
   ```bash
   ssh "$VM_USER@$VM_HOST" "sudo ln -sfn /opt/blog-v{N-1} /opt/blog && sudo systemctl restart blog && sudo systemctl is-active blog"
   curl -fsS "https://$BLOG_DOMAIN/api/health"
   ```
   - 기대 결과: 이전 릴리즈 복구 후 서비스가 즉시 정상화되고 헬스체크 200 응답

10. **경로 필터/역할 분리 정책 회귀 검증 (`deploy.yml`/`ci.yml`)**
   ```bash
   node scripts/test-step-6.mjs --check-workflow-policy
   ```
   - 기대 결과: `deploy.yml`에 `push.main + paths + workflow_dispatch`가 모두 존재하고, `ci.yml`에는 배포 단계가 없어야 함

11. **배포 Runbook 기록 확인 (운영 게이트)**
   ```bash
   # 예시: runbook 파일 또는 운영 로그에 필수 항목 기록 여부 확인
   # 항목: 마지막 성공 run-id, 배포 시각(UTC/KST), 적용 릴리즈 경로
   ```
   - 기대 결과: 배포 1회당 필수 항목 3개가 누락 없이 기록됨

#### 피드백 루프

- 이전 단계: 빌드 실패 시 Step 1~5의 TypeScript 에러, 의존성 문제 재점검. standalone에 better-sqlite3 미포함 시 `next.config.ts`의 `serverExternalPackages` 확인.
- 다음 단계: 아티팩트가 정상이어야 Step 7에서 VM에 배포 가능.
- 회귀 테스트: 의존성 변경 시마다 아티팩트 무결성 테스트 재실행
- 릴리즈 판정 필수 게이트: 테스트 6(GitHub Actions 실제 실행), 테스트 8(원격 스모크), 테스트 9(롤백 검증) 3개를 모두 통과해야 배포 성공으로 판정
- 문서 동기화: Step 6 확정 후 `plans/step7-plan.md` 롤백 경로 표기와 `docs/codebase.md` CI/CD 섹션을 최신 운영 정책으로 갱신
