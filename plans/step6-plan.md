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
| 6-2 | 네이티브 빌드 | 동일 아키텍처 의존 (ubuntu-latest x86_64) | GitHub Actions와 Oracle VM 모두 x86_64 Linux. prebuild 호환 |
| 6-3 | 아티팩트 전송 | SCP/SSH 직접 전송 (`tar.gz` → `scp` → `ssh systemctl restart`) | 가장 단순. 개인 프로젝트에 rsync 최적화 불필요 |

> **의존성 영향**: 전송 방식(SSH) → Step 7 방화벽 규칙 / 빌드 환경 → Step 7 바이너리 호환성

#### 선행 조건 (Preflight)

- 워크플로우 파일 준비:
  - `.github/workflows/deploy.yml` 신규 생성
  - 기존 `.github/workflows/ci.yml`와 트리거 충돌(브랜치/경로/실행 목적) 점검
- 스크립트 준비:
  - `scripts/test-step-6.mjs` placeholder를 Gate 검증 로직으로 교체
  - `scripts/test-all.mjs`에서 Step 6 호출 여부를 운영 정책에 맞게 정렬
- npm 스크립트 정렬:
  - `package.json`에 `"test:step6": "node scripts/test-step-6.mjs"` 추가
  - Step 6 착수 시점의 `test:all` 포함 범위를 문서 정책과 일치시킴
- Step 6 영향 파일:
  - `.github/workflows/deploy.yml`
  - `.github/workflows/ci.yml`
  - `scripts/test-step-6.mjs`
  - `scripts/test-all.mjs`
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

#### 실행 전 확정 질의 (관점 6 반영)

- `deploy.yml` 자동 트리거 범위는 `main` push만 사용한다. (`workflow_dispatch`는 사용하지 않음)
- `.github/workflows/ci.yml`는 `검증 전용`, `deploy.yml`은 `배포 전용`으로 분리 운영한다.
- 롤백 대상 릴리즈 식별 규칙(`<previous>`)은 최신 성공 릴리즈의 직전 버전으로 고정한다.
- 배포 스모크 실패 시 즉시 롤백한다. (재시도 없음)
- `BLOG_DOMAIN`, `VM_HOST`, `VM_USER`, `VM_SSH_KEY`는 모두 GitHub Secrets에 저장한다.

#### 구현 내용

**6-1. 빌드 워크플로우 (`.github/workflows/deploy.yml`)**

```yaml
name: Build & Deploy
on:
  push:
    branches: [main]

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

**6-2. 배포 시크릿 (GitHub Secrets)**

| Secret | 용도 |
|--------|------|
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
```

> `scripts/test-step-6.mjs` — 클린 빌드, 아티팩트 패키징, 무결성 검증(별도 디렉토리 실행), 네이티브 바인딩 존재, 워크플로우 문법을 자동 실행.
> 테스트 6~8은 CI/CD 파이프라인/원격 서버 상태를 포함하므로 자동 검증과 수동 확인을 분리해 운영한다.

#### 자동 검증 vs 수동 확인 경계

- 자동 검증 (`scripts/test-step-6.mjs`):
  - 로컬 클린 빌드, standalone 패키징, 아티팩트 무결성, 네이티브 바인딩, 워크플로우 구조 검사
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
   - 기대 결과: 수동 트리거된 배포 파이프라인이 정상 완료되고, 아티팩트 생성/전송 단계 로그가 확인됨

8. **원격 배포 스모크 테스트 (SSH 전송 + 재기동 + 헬스체크)**
   ```bash
   ssh "$VM_USER@$VM_HOST" "sudo systemctl restart blog && sudo systemctl is-active blog"
   curl -fsS "https://$BLOG_DOMAIN/api/health"
   ```
   - 기대 결과: `systemctl is-active` 결과가 `active`, `/api/health`가 200 응답

9. **배포 실패 시 롤백 검증 (스모크 실패 조건)**
   ```bash
   ssh "$VM_USER@$VM_HOST" "cd /opt/blog && ln -sfn /opt/blog/releases/<previous> current && sudo systemctl restart blog && sudo systemctl is-active blog"
   curl -fsS "https://$BLOG_DOMAIN/api/health"
   ```
   - 기대 결과: 이전 릴리즈 복구 후 서비스가 즉시 정상화되고 헬스체크 200 응답

#### 피드백 루프

- 이전 단계: 빌드 실패 시 Step 1~5의 TypeScript 에러, 의존성 문제 재점검. standalone에 better-sqlite3 미포함 시 `next.config.ts`의 `serverExternalPackages` 확인.
- 다음 단계: 아티팩트가 정상이어야 Step 7에서 VM에 배포 가능.
- 회귀 테스트: 의존성 변경 시마다 아티팩트 무결성 테스트 재실행
