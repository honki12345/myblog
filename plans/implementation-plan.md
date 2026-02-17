# 통합 구현 & 테스트 계획서

> 기반 문서: `plans/blog-architecture.md`
> 작성일: 2026-02-14
> 결정 사항: 각 Step의 "사전 결정 사항" 섹션에 통합
>
> **테스트 원칙**: 단위 테스트/목(mock) 최대한 지양. 실제 SQLite DB, 실제 HTTP 요청, 실제 마크다운 렌더링 등 통합/E2E 테스트 위주.
> **테스트 도구**: curl, Node.js 스크립트, shell 스크립트, Playwright(E2E + 스크린샷 회귀) 사용.
> **테스트 자동화**: 각 Step의 테스트를 `scripts/test-step-N.mjs`로 통합하고, UI 관련 검증은 Playwright 스크린샷 비교(`toHaveScreenshot`)를 기본으로 자동화한다.
> **UI 안정화 규칙**: 스크린샷 테스트는 애니메이션 비활성화, 고정 시드 데이터, 고정 타임존/로케일을 적용하고 실패 시 diff 이미지를 아티팩트로 남긴다.
> **회귀 운영 원칙**: Step 2 완료 이후 각 Step 구현/수정 종료 시마다 `npm run test:all` 재실행.
> **진행 게이트**: 회귀 테스트가 실패하면 다음 Step 진행/커밋을 중단하고, 수정 후 전체 재실행으로 통과를 확인.

---

## 1. 확정된 기술 선택

| 항목 | 선택 | 비고 |
|------|------|------|
| ORM | **better-sqlite3 직접 사용** | raw SQL, 의존성 최소, 메모리 절약 |
| 패키지 매니저 | **npm** | Node.js 기본 내장 |
| Node.js | **22 LTS** | 2027-04까지 지원 |
| 마크다운 | **Tier 1~4 전부** | GFM + shiki + KaTeX + Mermaid |
| 프레임워크 | **Next.js 16 (App Router)** | standalone 모드, Turbopack 기본 |
| 스타일링 | **Tailwind CSS v4** | |
| 리버스 프록시 | **Caddy** | 자동 HTTPS |
| 프로세스 관리 | **systemd** | |
| 빌드/배포 | **GitHub Actions → Oracle VM** | |
| 관리자 인증 (웹 UI) | **단일 admin 계정 + 비밀번호 + TOTP(2FA) + HttpOnly Session 쿠키 (Phase 2 Step 9 적용)** | AI API Key와 분리 운영 |

---

## 1-1. Admin 인증/2FA 방식 옵션 비교 (신규 요구사항 반영)

| 옵션 | 방식 | 장점 | 단점 |
|------|------|------|------|
| A | API Key를 `/write`에서 직접 입력 후 localStorage 저장 | 구현이 가장 빠르고 기존 API 재사용 가능 | XSS/브라우저 확장프로그램 노출 시 키 탈취 위험, 키 유출 시 AI 자동 포스팅 API까지 동시에 노출, 로그아웃/만료 제어 어려움 |
| B | 단일 admin 계정(ID/PW) + 서버 세션(`HttpOnly`, `Secure`, `SameSite=Lax`) | 브라우저 JS에서 세션 토큰 직접 접근 불가, 세션 만료/강제 로그아웃/감사 로그가 쉬움 | 1FA만으로는 계정 탈취 위험이 남고, 별도 2FA 정책을 추가 설계해야 함 |
| C | OAuth(Auth.js + GitHub/Google 등) | 비밀번호 직접 관리 부담 감소, 공급자 MFA 활용 가능 | 외부 의존성 증가, 초기 설정/운영 복잡도 증가, 개인 블로그 단일 관리자 요구에는 과할 수 있음 |
| D | 단일 admin 계정(ID/PW) + TOTP(Authenticator 앱) + 서버 세션 **(최종 선택)** | 개인 프로젝트에서 구현 난이도/보안 균형이 가장 좋고, AI API Key와 권한 분리를 유지할 수 있음 | TOTP 등록/복구코드 발급/분실 대응 플로우를 추가 구현해야 함 |

**결정**: `옵션 D`를 채택한다.  
AI 자동 포스팅은 기존 `BLOG_API_KEY`를 계속 사용하고, 브라우저 기반 관리 기능(글쓰기/메모/일정/TODO)은 `admin 2FA 세션 인증`으로 분리한다.

**적용 시점**
- Phase 1 Step 5: 기존 `/write` MVP(API Key 방식) 유지
- Phase 2 Step 9: `/admin/login`(비밀번호 1차 + TOTP 2차) + `/admin/*`로 전환하고 `/write`는 `/admin/write`로 리다이렉트

---

## 2. 의존성 목록

### 프로덕션 의존성

```
next
react
react-dom
better-sqlite3

# 마크다운 렌더링 파이프라인
unified
remark-parse
remark-gfm
remark-math
remark-rehype
rehype-katex
rehype-sanitize
rehype-stringify
shiki                     # 코드 하이라이팅 (서버 렌더링)
marked                    # 글쓰기 프리뷰(클라이언트 경량 렌더링)
isomorphic-dompurify      # 글쓰기 프리뷰 sanitize
```

### 개발 의존성

```
typescript
@types/node
@types/react
@types/react-dom
@types/better-sqlite3
tailwindcss
@tailwindcss/postcss
```

### Mermaid (클라이언트 렌더링)

```
mermaid                   # 클라이언트에서 다이어그램 렌더링
```

> Mermaid는 ~500KB 번들이므로 dynamic import로 필요한 페이지에서만 로드.
> 1GB VM에서 puppeteer 서버 렌더링 불가 → 클라이언트 전용.

---

## 3. 구현 순서 개요

전체 구현은 **4개 Phase (Step 1~21)** 기준으로 설계했고, 분리된 Step은 완료 처리로 간주한다.

### 2026-02-16 기준 진행 상태

- 완료(분리/처리): **Step 1~9**
- 남은 Step: **Step 10 → Step 21**

### 남은 Step 실행 순서

```
Phase 3: 사용자 편의 (Step 10~15)
  Step 10: 전문 검색 UI (FTS5 연동)
  Step 11: 커서 기반 페이지네이션 전환
  Step 12: 반응형 디자인 개선 (360/768/1440 기준)
  Step 13: RSS/Atom 피드 구현
  Step 14: Step 10~13 통합 검증 (기능 + 스크린샷 회귀 + 접근성)
  Step 15: 회귀 게이트 실행 (`npm run test:all`)
    ↓
Phase 4: 고급 기능 (Step 16~21)
  Step 16: 조회수 통계
  Step 17: 북마크/읽음 표시
  Step 18: 구독 메일링 (일간/주간 다이제스트, 비MVP)
  Step 19: DB 자동 백업 (cron, 7일 보관, 자동 삭제)
  Step 20: 디스크 사용량 모니터링 (80% 이상 알림)
  Step 21: 최종 회귀/운영 검증 (`npm run test:all`, `npm run test:step7-remote`)
```

### 전체 의존성 맵

```
Step 1 (초기화)
  ├─ standalone 설정 ──────────────────→ Step 6 (CI 아티팩트 구조)
  ├─ Tailwind v4 설정 ────────────────→ Step 5 (컴포넌트 스타일링)
  └─ tsconfig ─────────────────────────→ 모든 Step

Step 2 (DB)
  ├─ 마이그레이션 전략 ──────────────→ Step 6 (배포 시 마이그레이션)
  ├─ DB 파일 위치 ───────────────────→ Step 7 (systemd 환경변수)
  ├─ 네이티브 바인딩 ────────────────→ Step 6 (CI 빌드 호환성)
  └─ 발행일 인덱스(status+published_at) → Phase 4 (메일링 대상 조회)

Step 3 (API)
  ├─ Slug 형식 ──────────────────────→ Step 5 ([slug] 라우팅)
  ├─ 에러 형식 ──────────────────────→ AI 클라이언트 개발
  ├─ Zod 의존성 ─────────────────────→ Step 6 (빌드 포함)
  ├─ 업로드 경로 (uploads/YYYY/MM/) ─→ Step 7 (Caddy root 설정)
  ├─ 헬스체크 (/api/health) ─────────→ Step 7 (UptimeRobot 모니터링)
  ├─ published_at 전이 규칙 ─────────→ Phase 4 (중복 메일 방지)
  └─ AI API Key 인증(BLOG_API_KEY) ──→ Phase 2 Step 9 (admin 2FA 세션 인증과 분리)

Step 4 (마크다운)
  ├─ sanitize 스키마 ────────────────→ Step 5 (렌더링 품질)
  ├─ shiki 언어 수 ──────────────────→ Step 7 (메모리 예산)
  └─ KaTeX CSS ──────────────────────→ Step 5 (layout.tsx)

Step 5 (프론트엔드)
  ├─ SSR 캐싱 ───────────────────────→ Step 7 (메모리 사용량)
  ├─ 캐시 무효화 (revalidatePath) ───→ Step 3 (POST/PATCH에 revalidate 추가)
  └─ 고정 permalink (/posts/[slug]) ─→ Phase 4 (메일 본문 링크 안정성)
       ※ 역방향 의존성: Step 5 설계 후 Step 3 코드에 반영 필요

Step 6 (CI/CD)
  ├─ 전송 방식 (SSH) ────────────────→ Step 7 (OCI Security List + ufw 규칙)
  └─ 빌드 환경 ──────────────────────→ Step 7 (바이너리 호환성)

Step 7 (배포)
  ├─ 보안 하드닝 (OCI + ufw + fail2ban)
  ├─ DB 백업 (sqlite3 .backup)
  └─ 최종 배포 설정

Step 8 (AI 친화 기능)
  ├─ bulk insert 정책 (최대 10건) + 트랜잭션 처리 시간 관리
  ├─ sources 메타데이터(`ai_model`, `prompt_hint`) 기록
  └─ API 요청 JSON 구조화 로그 표준화

Step 9 (관리자 워크스페이스, Step 5 이후)
  ├─ admin 2FA 세션 인증 + CSRF 방어
  ├─ admin 전용 스키마(`admin_notes`, `admin_todos`, `admin_schedules`) 신규 마이그레이션
  └─ `/api/admin/*` 권한 분리로 AI API 권한 최소화
```

---

## Phase 1: MVP (Step 1~7)

---

### Step 1: 프로젝트 초기화 & 설정

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 1-1 | standalone 빌드 설정 | `output: 'standalone'` + `serverExternalPackages: ['better-sqlite3']` | 네이티브 바인딩이 standalone 번들에 올바르게 포함되도록 초기에 해결. 나중에 바꾸면 Step 6~7 전체 재작성 필요 |
| 1-2 | Tailwind CSS v4 설정 | v4 네이티브 (CSS `@theme`) | 신규 프로젝트이므로 레거시 호환(`@tailwindcss/compat`) 불필요. `create-next-app --tailwind` 기반 조정 |
| 1-3 | tsconfig | `create-next-app` 기본값 (`strict: true`, `@/*` alias) | strict 모드로 better-sqlite3 반환값 타입 실수 방지. alias로 깔끔한 import |
| 1-4 | UI 반응형 기준 | 모바일 우선 반응형 (최소 360px ~ 데스크톱 1440px) | 초기 단계에서 반응형 기준을 고정해야 Step 5 UI 재작업과 레이아웃 회귀를 줄일 수 있음 |

> **의존성 영향**: standalone → Step 6 CI 아티팩트, Step 7 systemd 경로 / Tailwind → Step 5 스타일링 / UI 반응형 기준 → Step 5 페이지 레이아웃 / tsconfig → 모든 Step

#### 구현 내용

**1-1. Next.js 프로젝트 생성**

```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --no-linter --import-alias "@/*"
```

> `.`은 현재 디렉토리(프로젝트 루트)에 생성. 별도 하위 디렉토리 없음.
> 현재 저장소 루트에서 직접 초기화한다.
> 실행 전 `git status --short`, `ls -la`로 파일 충돌 가능성을 확인한다.

> `--no-linter`: MVP에서는 린터 제외, 필요시 나중에 추가.
> `--import-alias "@/*"`: alias를 유지해 import 경로를 일관되게 관리.

**1-2. `next.config.ts` 수정**

```ts
const nextConfig = {
  output: 'standalone',  // 배포용 standalone 빌드
  serverExternalPackages: ['better-sqlite3'], // 네이티브 바인딩 패키지 명시
};
```

**1-3. 환경변수 파일**

`.env.local` (gitignore에 포함):

```env
BLOG_API_KEY=<생성할 API 키>
```

`.env.example` (커밋용 템플릿):

```env
BLOG_API_KEY=your-api-key-here
```

> **API Key 실주입 시점 정책**
> - Step 1~6: 저장소 내 `.env.local`은 플레이스홀더/개인 로컬 키만 사용 (실운영 키 커밋 금지).
> - Step 7 배포 직전: 대상 서버에서만 실운영 `BLOG_API_KEY` 주입 (`systemd` 환경변수 또는 서버 전용 env 파일).
> - 배포 후 검증: `/api/health` 확인 뒤 인증이 필요한 API(`POST /api/posts`)를 실키 기준으로 점검.
> - CI UI 테스트: 워크플로우 job env로 `BLOG_API_KEY`를 주입하고, 테스트 서버 실행 시 이미 설정된 키를 `.env.local`로 덮어쓰지 않는다.

**1-4. 디렉토리 구조 생성**

```
.
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── posts/
│   │   │   ├── page.tsx
│   │   │   └── [slug]/
│   │   │       └── page.tsx
│   │   ├── tags/
│   │   │   └── [tag]/
│   │   │       └── page.tsx
│   │   ├── write/
│   │   │   └── page.tsx         # 글 작성/수정 (API Key 인증)
│   │   └── api/
│   │       ├── posts/
│   │       │   ├── route.ts     # POST: 글 생성 / GET: 목록
│   │       │   ├── check/
│   │       │   │   └── route.ts # GET: source_url 중복 체크
│   │       │   └── [id]/
│   │       │       └── route.ts # GET/PATCH: 개별 글 조회/수정
│   │       ├── uploads/
│   │       │   └── route.ts     # POST: 이미지 업로드
│   │       └── health/
│   │           └── route.ts     # GET: 헬스체크
│   ├── lib/
│   │   ├── db.ts               # SQLite 연결 & 초기화 & 마이그레이션
│   │   ├── auth.ts             # API Key 검증 (crypto.timingSafeEqual)
│   │   ├── slug.ts             # Slug 생성
│   │   ├── rate-limit.ts       # 인메모리 Rate Limiting
│   │   └── markdown.ts         # 마크다운 → HTML 변환
│   └── components/
│       ├── PostCard.tsx         # 글 카드 컴포넌트
│       ├── PostContent.tsx      # 마크다운 렌더링 컴포넌트
│       ├── MermaidDiagram.tsx   # Mermaid 클라이언트 렌더링
│       └── TagList.tsx          # 태그 목록
├── scripts/               # 마이그레이션, 테스트 스크립트
│   ├── migrate.ts
│   ├── test-step-1.mjs
│   ├── test-step-2.mjs
│   ├── test-step-3.mjs
│   ├── test-step-4.mjs
│   ├── test-step-5.mjs
│   ├── test-step-6.mjs
│   ├── test-step-7-local.mjs
│   ├── test-step-7-remote.mjs
│   ├── test-all.mjs
│   └── cleanup-test-data.mjs
├── data/                  # SQLite DB 파일 (gitignore)
├── uploads/               # 이미지 저장 (gitignore)
├── next.config.ts
├── package.json
├── .env.local
└── .env.example
```

**1-5. `.gitignore` 추가 항목**

```
data/
uploads/
.env.local
```

**1-6. Step 1 테스트 자동화 연결**

- `scripts/test-step-1.mjs` 파일을 생성해 Gate Criteria를 자동 검증한다.
- `package.json`에 아래 스크립트를 추가한다.

```json
{
  "scripts": {
    "test:step1": "node scripts/test-step-1.mjs"
  }
}
```

#### 통과 기준 (Gate Criteria)

- `npm run build`가 에러 없이 완료되고, `.next/standalone/server.js` 파일이 생성된다.
- `npm run dev`로 개발 서버가 기동되어 `http://localhost:3000`에 응답한다.
- 환경변수 파일(`.env.local`, `.env.example`)이 존재하고 구조가 올바르다.
- 모바일(360x800)과 데스크톱(1440x900) 뷰포트에서 핵심 레이아웃이 깨지지 않는다.

#### 자동화 실행

```bash
npm run test:step1
```

> `scripts/test-step-1.mjs` — 빌드, standalone 출력, 서버 기동, 환경변수, gitignore를 한 번에 검증.
> 서버 프로세스 시작/종료, 파일 존재 확인, HTTP 응답 코드 검증을 모두 자동화.

#### 테스트 목록

1. **프로덕션 빌드 성공 테스트**
   ```bash
   npm run build
   echo $?
   ```
   - 기대 결과: 종료 코드 `0`, 에러 메시지 없음
   - 실패 시: `next.config.ts`에 `output: 'standalone'` 설정 여부, TypeScript 컴파일 에러, 의존성 누락

2. **standalone 출력 구조 확인**
   ```bash
   ls -la .next/standalone/server.js
   ls -la .next/static/
   ```
   - 기대 결과: `server.js` 파일 존재, `.next/static/` 디렉토리에 CSS/JS 파일 존재

3. **standalone 모드 서버 기동 테스트**
   ```bash
   cd .next/standalone && PORT=3001 node server.js &
   sleep 3
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3001
   kill %1
   ```
   - 기대 결과: HTTP `200`

4. **개발 서버 기동 & 응답 테스트**
   ```bash
   npm run dev &
   sleep 5
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
   kill %1
   ```
   - 기대 결과: HTTP `200`

5. **환경변수 파일 존재 확인**
   ```bash
   test -f .env.local && echo "OK" || echo "MISSING"
   test -f .env.example && echo "OK" || echo "MISSING"
   grep -q "BLOG_API_KEY" .env.example && echo "OK" || echo "MISSING KEY"
   ```
   - 기대 결과: 세 줄 모두 `OK`

6. **`.gitignore` 설정 확인**
   ```bash
   grep -q "data/" .gitignore && echo "OK" || echo "MISSING"
   grep -q ".env.local" .gitignore && echo "OK" || echo "MISSING"
   ```
   - 기대 결과: 두 줄 모두 `OK`

7. **반응형 레이아웃 확인 (수동)**
   ```bash
   npm run dev
   ```
   - 수동 점검 절차:
     1) 브라우저에서 `http://localhost:3000` 접속
     2) DevTools 열기 후 Device Toolbar 활성화 (`Ctrl+Shift+M` 또는 `Cmd+Shift+M`)
     3) 뷰포트 순서대로 전환: `360x800` → `768x1024` → `1440x900`
     4) 각 뷰포트에서 경로 점검: `/`, `/posts`, `/write`, `/tags`, `/tags/sample`
   - 체크리스트:
     - 가로 스크롤이 생기지 않는다.
     - 본문/카드/폼이 화면 밖으로 잘리지 않는다.
     - 버튼/링크가 겹치지 않고 클릭 가능한 크기(모바일 기준 약 40px 이상)를 유지한다.
     - 제목/본문 텍스트가 지나치게 작거나 줄바꿈 깨짐 없이 읽힌다.
   - 기대 결과: 위 체크리스트를 3개 뷰포트에서 모두 충족한다.

#### 피드백 루프

- 다음 단계 영향: standalone 빌드가 실패하면 Step 6(CI/CD)에서도 실패. `output: 'standalone'` 설정이 없으면 Step 7 배포 불가능.
- 회귀 테스트: Step 2 이후 의존성 추가 시마다 `npm run build` 재실행

---

### Step 2: SQLite DB 연결 & 스키마 생성

> 상세 구현 계획은 `plans/step2-plan.md`를 참고.
> 분리일: 2026-02-14

---

### Step 3: API Routes (AI 포스팅 API)

> 상세 구현 계획은 `plans/step3-plan.md`를 참고.
> 분리일: 2026-02-14

---

### Step 4: 마크다운 렌더링 파이프라인

> 상세 구현 계획은 `plans/step4-plan.md`를 참고.
> 분리일: 2026-02-15

---

### Step 5: 프론트엔드 페이지 (SSR)

> 상세 구현 계획은 `plans/step5-plan.md`를 참고.
> 분리일: 2026-02-15

---

### Step 6: GitHub Actions CI/CD

> 상세 구현 계획은 `plans/step6-plan.md`를 참고.
> 분리일: 2026-02-15

---

### Step 7: Oracle VM 배포 설정

> 상세 구현 계획은 `plans/step7-plan.md`를 참고.
> 분리일: 2026-02-15

---
## Phase 2: 운영 확장 (Step 8~9)

> Phase 1 MVP 완료 후 진행.

### Step 8: AI 친화 기능

> 상세 구현 계획은 `plans/step8-plan.md`를 참고.
> 분리일: 2026-02-16
> 구현 완료일: 2026-02-16

#### 구현 결과 (2026-02-16)

- `POST /api/posts/bulk` 추가
  - 최대 10건 입력 검증
  - 단일 트랜잭션(all-or-nothing) 처리 및 실패 시 전량 롤백
  - `DUPLICATE_SOURCE`(요청 내부/기존 데이터/경합) 처리
  - bulk 전용 레이트 리밋(`3 req / 60s`) 적용
- `POST /api/posts` 확장
  - `aiModel`, `promptHint` optional 수신
  - `sources.ai_model`, `sources.prompt_hint` 저장
  - 단건 레이트 리밋 카운터를 bulk와 분리
- 구조화 로그 공통 유틸(`src/lib/api-log.ts`) 도입
  - `timestamp`, `route`, `status`, `durationMs`
  - `postCount`, `contentLengthSum`, `sourceUrlCount`, `payloadHash`
  - 본문 원문(`title`, `content`, `promptHint`) 비기록
- Step 8 전용 회귀 스크립트 추가
  - `scripts/test-step-8.mjs`
  - `package.json`에 `test:step8` 등록
  - `scripts/test-all.mjs`에 `test:step8` 편입
- 이미지 포함 작성 E2E 흐름은 기존 `tests/ui/write-e2e.spec.ts`로 유지/검증

---

### Step 9: 관리자 워크스페이스 (Step 5 이후 신규)

> 상세 구현 계획은 `plans/step9-plan.md`를 참고.
> 분리일: 2026-02-16
> 구현 완료일: 2026-02-16 (분리 처리 기준)

---

## Phase 3: 사용자 편의 (Step 10~15)

> Phase 2 Step 9 완료 상태를 기준으로 진행.

### Step 10: 전문 검색 UI (FTS5)

> 상세 구현 계획은 `plans/step10-plan.md`를 참고.
> 분리일: 2026-02-17

---

### Step 11: 커서 기반 페이지네이션 전환

> 상세 구현 계획은 `plans/step11-plan.md`를 참고.
> 분리일: 2026-02-17

---

### Step 12~15: 사용자 편의 기능

#### 구현 항목

- **Step 12. 반응형 디자인 개선** — 모바일 최적화
- **Step 13. RSS/Atom 피드** — 카테고리별, 태그별 동적 피드 생성
- **Step 14. Step 10~13 통합 검증** — 기능 assertion + 스크린샷 회귀 + 접근성 검사
- **Step 15. Step 10 종료 회귀** — `npm run test:all`

---

## Phase 4: 고급 기능 (Step 16~21)

> Step 15 완료 후 진행.

### Step 16~21: 고급 기능

#### 구현 항목

- **Step 16. 조회수 통계** — 인기 글, 카테고리별 통계, AI 글 vs 직접 쓴 글 구분
- **Step 17. 북마크/읽음 표시** — 사용자 읽은 글 추적, "안 읽은 글만 보기"
- **Step 18. 구독 메일링 (비MVP 확장)** — 일간/주간 다이제스트 발송
  - 구독자 주기(`daily`/`weekly`) 저장
  - `published_at` 구간 조회로 발송 대상 글 선정
  - 발송 이력(구독자+기간) 저장으로 중복 발송 방지
- **Step 19. DB 자동 백업** — cron, 7일 보관, 오래된 백업 자동 삭제
- **Step 20. 디스크 사용량 모니터링** — 80% 이상 시 알림
- **Step 21. 최종 회귀/운영 검증** — `npm run test:all`, `npm run test:step7-remote`

---

## 체크리스트

### 완료 처리된 Step (분리 문서 기준)

- [x] **Step 1**: 프로젝트 초기화 & 설정 (`plans/step1-plan.md`)
- [x] **Step 2**: SQLite DB 연결 & 스키마 생성 (`plans/step2-plan.md`)
- [x] **Step 3**: API Routes (AI 포스팅 API) (`plans/step3-plan.md`)
- [x] **Step 4**: 마크다운 렌더링 파이프라인 (`plans/step4-plan.md`)
- [x] **Step 5**: 프론트엔드 페이지 (SSR) (`plans/step5-plan.md`)
- [x] **Step 6**: GitHub Actions CI/CD (`plans/step6-plan.md`)
- [x] **Step 7**: Oracle VM 배포 설정 (`plans/step7-plan.md`)
- [x] **Step 8**: AI 친화 기능 (`plans/step8-plan.md`)
- [x] **Step 9**: 관리자 워크스페이스 (`plans/step9-plan.md`)

### 남은 Step (실행 순서)

1. [ ] **Step 10**: 전문 검색 UI (FTS5, SearchBar 컴포넌트) (`plans/step10-plan.md`)
2. [ ] **Step 11**: 커서 기반 페이지네이션 (`plans/step11-plan.md`)
3. [ ] **Step 12**: 반응형 디자인 개선
4. [ ] **Step 13**: RSS/Atom 피드
5. [ ] **Step 14**: Step 10~13 통합 검증 (기능 assertion + `toHaveScreenshot` + a11y)
6. [ ] **Step 15**: Step 10 종료 회귀 (`npm run test:all`)
7. [ ] **Step 16**: 조회수 통계
8. [ ] **Step 17**: 북마크/읽음 표시
9. [ ] **Step 18**: 구독 메일링 (일간/주간 다이제스트, 비MVP)
10. [ ] **Step 19**: DB 자동 백업 (cron, 7일 보관, 자동 삭제)
11. [ ] **Step 20**: 디스크 사용량 모니터링 (80% 이상 알림)
12. [ ] **Step 21**: 최종 회귀/운영 검증 (`npm run test:all`, `npm run test:step7-remote`)

---

## 주의사항 & 설계 결정

### better-sqlite3 사용 시 주의

1. **Prepared Statement 필수**: SQL injection 방지를 위해 모든 쿼리에 파라미터 바인딩 사용
2. **동기 API**: better-sqlite3는 동기 API. Next.js API Route에서 비동기 래핑 불필요
3. **FTS5 트리거**: posts 테이블 변경 시 FTS 인덱스 자동 동기화 (트리거로 처리)
4. **Hot reload 대응**: 개발 모드에서 DB 연결이 중복 생성되지 않도록 글로벌 변수 활용

### 메일링 확장 대비 (비MVP, 지금 반영할 원칙)

1. **발행 시각 단일 기준 유지**: `published_at`을 "최초 발행 시각"으로 취급하여 RSS/메일링 집계 기준을 통일
2. **조회 쿼리 성능 선반영**: `idx_posts_status_published_at` 인덱스로 일간/주간 범위 조회를 현재 스키마에서 바로 지원
3. **링크 안정성 유지**: 외부 공유 URL을 `/posts/[slug]`로 고정해 추후 메일 본문 링크 생성 로직 재사용
4. **확장용 엔드포인트 네임스페이스 예약**: 추후 `/api/subscriptions`, `/api/newsletter/*`를 충돌 없이 추가할 수 있게 라우팅 명명 규칙 유지

### Mermaid 클라이언트 렌더링 전략

- 마크다운 서버 렌더링 시 `` ```mermaid `` 블록을 `<div class="mermaid-container">` + `<pre>` 형태로 변환
- 클라이언트 컴포넌트가 마운트 후 `<pre>` 내용을 mermaid.render()로 SVG 변환
- mermaid 라이브러리는 `next/dynamic`으로 lazy load

### 마크다운 Sanitize 커스텀 설정

rehypeSanitize의 기본 스키마는 `style` 속성을 제거한다. 하지만:
- **shiki**: 인라인 `style`로 구문 색상 적용 → `style` 허용 필요
- **katex**: 전용 class 사용 → class 허용 필요
- **mermaid**: 클라이언트 렌더링이므로 sanitize 영향 없음

커스텀 스키마에서 `span[style]`, katex 관련 태그/class를 화이트리스트에 추가해야 한다.

### standalone 빌드 구조

`next build` 후 `.next/standalone/` 디렉토리에 `server.js`와 필요한 node_modules가 포함된다.
배포 시 필요한 파일:

```
.next/standalone/     ← server.js + node_modules (자동 트리쉐이킹)
.next/static/         ← CSS, JS 등 정적 자원
public/               ← 정적 파일
```

> **주의**: better-sqlite3는 네이티브 바인딩이므로 빌드 환경(GitHub Actions, ubuntu)과
> 배포 환경(Oracle VM, Oracle Linux/Ubuntu)의 OS/아키텍처가 동일해야 한다.
> 둘 다 x86_64 Linux이면 문제없음.

---

## 부록: 테스트 데이터 정리 스크립트

각 Step 테스트 후 DB에 남은 테스트 데이터를 정리하는 스크립트.

```bash
#!/bin/bash
# scripts/cleanup-test-data.sh
cd "$(dirname "$0")/.."

node -e "
  const Database = require('better-sqlite3');
  const db = new Database('data/blog.db');
  db.pragma('foreign_keys = ON');

  const count = db.prepare('SELECT COUNT(*) as c FROM posts').get().c;
  console.log('현재 글 수:', count);

  db.prepare('DELETE FROM posts').run();
  db.prepare('DELETE FROM tags').run();
  db.prepare('DELETE FROM sources').run();

  console.log('테스트 데이터 정리 완료');
  db.close();
"
```

## 부록: package.json 테스트 스크립트

```json
{
  "scripts": {
    "test:step1": "node scripts/test-step-1.mjs",
    "test:step2": "node scripts/test-step-2.mjs",
    "test:step3": "node scripts/test-step-3.mjs",
    "test:step4": "node scripts/test-step-4.mjs",
    "test:step5": "node scripts/test-step-5.mjs",
    "test:step6": "node scripts/test-step-6.mjs",
    "test:step7-local": "node scripts/test-step-7-local.mjs",
    "test:step7-remote": "node scripts/test-step-7-remote.mjs",
    "test:all": "node scripts/test-all.mjs",
    "test:cleanup": "node scripts/cleanup-test-data.mjs"
  }
}
```

## 부록: 전체 회귀 테스트 실행 순서

Step 2 완료 이후부터는 각 Step 종료 시마다 실행하고, 모든 Step 완료 후 최종 검증으로 다시 실행:

```bash
npm run test:all
```

> `scripts/test-all.mjs` — 아래 순서로 각 Step 테스트를 순차 실행:

```
1. test:step1  — 빌드, standalone 출력, 서버 기동, 환경변수, gitignore
2. test:step2  — 마이그레이션, 스키마, WAL, CRUD, FTS5, 외래키, 멱등성
3. test:step3  — (dev 서버 자동 시작/종료) 인증, 입력 검증, CRUD, Rate Limit, E2E
4. test:step4  — 마크다운 Tier 1~4, XSS sanitize, 성능
5. test:step5  — (dev 서버 자동 시작/종료) 페이지 응답, 페이지네이션, 태그, 네비게이션
6. test:step6  — 클린 빌드, 아티팩트 패키징/실행, 네이티브 바인딩, 워크플로우
```

> Step 3, 5는 dev 서버가 필요하므로 스크립트 내부에서 서버 시작 → 테스트 → 서버 종료를 자동 처리.
> Step 7은 VM 환경 전용이므로 `test:all`에 포함하지 않음. 별도 실행.

개별 Step만 실행:

```bash
npm run test:step3             # Step 3만 실행
npm run test:step7-remote      # VM 배포 후 외부 테스트
```
