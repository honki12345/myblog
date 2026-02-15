# Step 7 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-15
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`, `plans/step6-plan.md`

---

### Step 7: Oracle VM 배포 설정

> 이 단계는 VM 인스턴스가 준비된 후 진행.

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 7-1 | VM OS | Ubuntu 22.04 Minimal | GitHub Actions와 동일 계열 → 바이너리 호환 확실. 커뮤니티 자료 풍부 |
| 7-2 | Node.js 설치 | NodeSource 공식 apt 리포지토리 | APT 기반 설치/업데이트 관리가 용이하고 보안 패치 반영이 단순함 |
| 7-3 | 배포 전략 | 심볼릭 링크 교체 (`/opt/blog-v{N}/` → `/opt/blog` symlink) | 1~3초 중단 허용. 롤백은 symlink 변경+restart 한 줄. 블루-그린은 메모리 2배 |
| 7-4 | 롤백 | 이전 3개 릴리즈 보관 → symlink 변경 | `ln -sfn /opt/blog-v{N-1} /opt/blog && systemctl restart blog`로 30초 내 복구 |
| 7-5 | 보안 하드닝 | OCI Security List(포트 제어) + VM 내부 ufw+fail2ban(앱 제어) 이중 레이어 | OCI: 22/80/443 인바운드만. fail2ban 기본값: `maxretry=5`, `bantime=30m` |
| 7-6 | DB 백업 WAL 안전성 | `sqlite3 .backup` 명령 (cp 대신) | WAL 모드에서도 라이브 DB의 일관된 스냅샷 백업을 지원. 공식 권장 방식 |

> **의존성 영향**: 보안 하드닝 → Step 6 SSH 배포가 차단되지 않도록 규칙 확인 / 백업 → `sqlite3` CLI 설치 필요

#### 선행 조건 (Preflight)

- npm 스크립트 정렬:
  - `package.json`에 `"test:step7-local": "node scripts/test-step-7-local.mjs"` 추가
  - `package.json`에 `"test:step7-remote": "node scripts/test-step-7-remote.mjs"` 추가
- 스크립트 준비:
  - `scripts/test-step-7-local.mjs` placeholder를 VM 내부 검증 코드로 교체
  - `scripts/test-step-7-remote.mjs` placeholder를 외부 접근/E2E 검증 코드로 교체
- 회귀 정책:
  - Step 7은 VM 환경 전용 검증이므로 `test:all`에 포함하지 않고 배포 시점에 별도 실행
- 필수 환경변수:
  - `BLOG_DOMAIN` (예: `blog.example.com`)
  - `API_KEY` (원격 API 인증 검증용)

#### 구현 내용

**7-1. 서버 초기 설정**

```bash
# Node.js 22 설치
# Caddy 설치
# blog 사용자 생성
# /opt/blog 디렉토리 생성
# data/ 디렉토리 생성 (SQLite DB)
# firewall: 22, 80, 443만 허용
```

**7-2. systemd 서비스**

아키텍처 문서 섹션 9-6의 `blog.service` 설정 사용.

**7-3. Caddy 설정**

```
blog.example.com {
    # 이미지 직접 서빙 (DB와 물리 분리)
    handle /uploads/* {
        root * /opt/blog
        file_server
        header X-Content-Type-Options nosniff
    }

    # DB 파일 접근 차단
    @blocked path *.db *.db-wal *.db-shm
    respond @blocked 403

    handle {
        reverse_proxy localhost:3000
    }
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    encode gzip
}
```

> HSTS preload 등록은 서브도메인 운영 정책이 고정된 이후 별도 검토한다.

**7-4. 배포 전략: 심볼릭 링크 전환 + 롤백**

1. 새 빌드를 `/opt/blog-v{N}/`에 압축 해제
2. `/opt/blog` 심볼릭 링크를 새 버전으로 전환: `ln -sfn /opt/blog-v{N} /opt/blog`
3. `systemctl restart blog`
4. 이전 버전 2-3개 보관 (롤백용)

**7-5. DB 백업 크론잡**

```bash
# 매일 새벽 3시 DB 안전 백업 (sqlite3 .backup 사용 — WAL 일관성 보장)
0 3 * * * sqlite3 /opt/blog/data/blog.db ".backup /opt/blog/backups/blog-$(date +\%Y\%m\%d).db"
# 7일 이상 된 백업 삭제
0 4 * * * find /opt/blog/backups -name "blog-*.db" -mtime +7 -delete
```

#### 통과 기준 (Gate Criteria)

- VM에서 Next.js standalone 서버가 systemd로 기동된다.
- Caddy를 통해 HTTPS로 외부 접근이 가능하다.
- 도메인으로 접속하면 블로그 페이지가 정상 표시된다.
- API 인증이 동작하고, 외부에서 글 생성이 가능하다.
- DB 백업 크론잡이 정상 동작한다.

#### 운영 판정 기준

- 배포 성공:
  - `systemctl is-active blog` 결과가 `active`
  - `https://$BLOG_DOMAIN/api/health`가 HTTP `200`
  - 테스트 6(API 인증)과 테스트 7(페이지 접근)의 핵심 검증이 통과
- 배포 실패(즉시 롤백 트리거):
  - `systemctl is-active blog != active`
  - `/api/health` 비정상 응답(타임아웃 포함)
  - API 인증/핵심 페이지 접근 실패가 1건 이상 발생

#### 실행 책임

- 배포 실행자: 운영 담당자 1인(개인 프로젝트 기준 본인)
- 배포 창구: 트래픽 저점 시간대에 실행(권장: KST 02:00~05:00)
- 승인 체계: 긴급 수정 외에는 main 머지 후 배포, 실패 시 롤백 후 원인 기록
- 롤백 방식: 배포 실패 기준 충족 시 자동 재시도 없이 즉시 수동 롤백을 실행한다.

#### 자동화 실행

```bash
export BLOG_DOMAIN="blog.example.com"
export API_KEY="${API_KEY:-$BLOG_API_KEY}" # 원격 API 인증 테스트용 키

# VM 내부에서 실행
npm run test:step7-local       # VM 내부 테스트 (systemd, 포트, 메모리, 방화벽, 백업)

# 외부에서 실행
npm run test:step7-remote      # HTTPS, 리다이렉트, API 인증, 페이지 접근, E2E
```

> `scripts/test-step-7-local.mjs` — VM 내부: 서버 환경, systemd 상태, 포트 응답, 방화벽, 메모리, 백업 크론잡, 자동 재시작을 순차 검증.
> `scripts/test-step-7-remote.mjs` — 외부: HTTPS, 리다이렉트, API 인증, 페이지 접근, DB 파일 차단, 전체 E2E.
> 환경변수 `BLOG_DOMAIN` (예: `blog.example.com`)으로 대상 서버 지정.

#### 테스트 목록

1. **서버 기본 환경 확인** (VM SSH)
   ```bash
   node --version          # v22.x
   caddy version           # v2.x
   free -m                 # 메모리 확인
   df -h /opt/blog         # 디스크 확인
   ```

2. **systemd 서비스 기동 & 상태 확인**
   ```bash
   sudo systemctl start blog
   sudo systemctl status blog
   journalctl -u blog --no-pager -n 20
   ```
   - 기대 결과: `Active: active (running)`, 로그에 에러 없음

3. **로컬 포트 응답 확인** (VM 내부)
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
   ```
   - 기대 결과: HTTP `200`

4. **Caddy 리버스 프록시 & HTTPS 확인** (외부)
   ```bash
   curl -s -o /dev/null -w "%{http_code}" "https://$BLOG_DOMAIN"
   curl -s -I "https://$BLOG_DOMAIN" | grep -i "strict-transport"
   ```
   - 기대 결과: HTTP `200`, HSTS 헤더 존재

5. **HTTP → HTTPS 리다이렉트** (외부)
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -L "http://$BLOG_DOMAIN"
   curl -s -o /dev/null -w "%{redirect_url}" "http://$BLOG_DOMAIN"
   ```
   - 기대 결과: 리다이렉트 URL이 `https://` 시작

6. **외부에서 API 인증 테스트** (외부)
   ```bash
   # 인증 없이 → 401
   curl -s -w "\n%{http_code}" -X POST "https://$BLOG_DOMAIN/api/posts" \
     -H "Content-Type: application/json" \
     -d '{"title":"test","content":"test"}'

   # 올바른 인증 → 201
   curl -s -w "\n%{http_code}" -X POST "https://$BLOG_DOMAIN/api/posts" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"title":"배포 테스트 글","content":"# 배포 완료\n\nVM에서 작성된 첫 글","status":"published"}'
   ```

7. **외부에서 페이지 접근 테스트** (외부)
   ```bash
   curl -s -o /dev/null -w "%{http_code}" "https://$BLOG_DOMAIN/"
   curl -s -o /dev/null -w "%{http_code}" "https://$BLOG_DOMAIN/posts"
   curl -s "https://$BLOG_DOMAIN/" | grep "배포 테스트 글"
   ```
   - 기대 결과: 모든 페이지 `200`, 생성한 글 표시

8. **방화벽 설정 확인** (VM 내부)
   ```bash
   sudo ufw status verbose
   sudo iptables -L -n | grep -E "22|80|443"
   ```
   - 기대 결과: ufw 활성 + default deny(incoming), 22/80/443만 허용

9. **메모리 사용량 확인** (VM 내부)
   ```bash
   free -m
   systemctl cat blog | grep -F "MemoryMax=400M"
   systemctl show blog --property=MemoryCurrent
   ps aux --sort=-%mem | head -10
   ```
   - 기대 결과: 전체 860MB 미만, blog 서비스 400MB 미만

10. **DB 백업 크론잡 테스트** (VM 내부)
    ```bash
    crontab -l | grep "blog.db"
    sqlite3 /opt/blog/data/blog.db ".backup /opt/blog/backups/blog-$(date +%Y%m%d)-test.db"
    ls -la /opt/blog/backups/
    sqlite3 /opt/blog/backups/blog-$(date +%Y%m%d)-test.db "PRAGMA integrity_check;"
    ```
    - 기대 결과: 크론잡 등록 확인, integrity check 결과 `ok`
    - 실패 대응: 무결성 실패 시 즉시 수동 `.backup` 재실행 후 최근 정상 백업 유지, 원인 분석 전 자동 삭제 중단

11. **systemd 자동 재시작 테스트** (VM 내부)
    ```bash
    PID1=$(systemctl show blog --property=MainPID --value)
    sudo kill -9 $PID1
    sleep 10
    PID2=$(systemctl show blog --property=MainPID --value)
    systemctl status blog
    if [ "$PID1" != "$PID2" ] && [ "$PID2" != "0" ]; then
      echo "AUTO RESTART TEST PASSED"
    fi
    ```

12. **SQLite 파일 웹 접근 차단 확인** (외부)
    ```bash
    curl -s -o /dev/null -w "%{http_code}" "https://$BLOG_DOMAIN/data/blog.db"
    curl -s -o /dev/null -w "%{http_code}" "https://$BLOG_DOMAIN/blog.db"
    ```
    - 기대 결과: HTTP `404` 또는 `403`

13. **전체 E2E — 외부에서 AI 포스팅 시나리오**
    ```js
    const DOMAIN = process.env.BLOG_DOMAIN;
    const API = `https://${DOMAIN}`;
    const KEY = process.env.API_KEY;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KEY}`
    };

    // 1. 글 생성
    let res = await fetch(`${API}/api/posts`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: '프로덕션 E2E 테스트',
        content: '## 테스트\n\n```python\nprint("hello")\n```\n\n$E=mc^2$',
        tags: ['e2e', 'production'],
        sourceUrl: 'https://example.com/prod-e2e',
        status: 'published'
      })
    });
    const { id, slug } = await res.json();
    console.log('1. CREATE:', res.status, id, slug);

    // 2. 웹 페이지에서 확인
    res = await fetch(`${API}/posts/${slug}`);
    const html = await res.text();
    const hasTitle = html.includes('프로덕션 E2E 테스트');
    const hasCode = html.includes('<pre');
    console.log('2. PAGE:', res.status, 'title:', hasTitle, 'code:', hasCode);

    // 3. 중복 체크
    res = await fetch(`${API}/api/posts/check?url=https://example.com/prod-e2e`, { headers });
    const check = await res.json();
    console.log('3. CHECK:', check.exists);  // true

    // 4. 수정
    res = await fetch(`${API}/api/posts/${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'draft' })
    });
    console.log('4. PATCH:', res.status);

    if (res.status === 200 && hasTitle && hasCode && check.exists) {
      console.log('PRODUCTION E2E TEST PASSED');
    } else {
      console.error('PRODUCTION E2E TEST FAILED');
    }
    ```

14. **fail2ban SSH 보호 동작 확인** (VM 내부)
    ```bash
    sudo fail2ban-client status
    sudo fail2ban-client status sshd
    ```
    - 기대 결과: `sshd` jail 활성, `maxretry=5`, `bantime=30m` 적용

15. **롤백 절차 검증** (VM 내부 + 외부)
    ```bash
    CURRENT=$(readlink -f /opt/blog)
    PREV=$(ls -1dt /opt/blog-v* | sed -n '2p')
    test -n "$PREV"

    sudo ln -sfn "$PREV" /opt/blog
    sudo systemctl restart blog
    curl -fsS "http://localhost:3000/api/health"
    curl -fsS "https://$BLOG_DOMAIN/api/health"

    # 원복
    sudo ln -sfn "$CURRENT" /opt/blog
    sudo systemctl restart blog
    ```
    - 기대 결과: 이전 릴리즈 전환 후 health check 성공, 원복 후에도 정상

#### 피드백 루프

- 이전 단계: VM OOM 시 Step 4 shiki 메모리 최적화 재점검. HTTPS 인증서 실패 시 DNS 확인. standalone 실행 실패 시 Step 6 빌드 재점검.
- 회귀 테스트: 매 배포마다 테스트 13번(전체 E2E) 실행. 메모리 사용량은 기능 추가 시마다 재측정.

---
