# 통합 구현 & 테스트 계획서

> 기반 문서: `plans/blog-architecture.md`
> 작성일: 2026-02-14
> 결정 사항: 각 Step의 "사전 결정 사항" 섹션에 통합
>
> **테스트 원칙**: 단위 테스트/목(mock) 최대한 지양. 실제 SQLite DB, 실제 HTTP 요청, 실제 마크다운 렌더링 등 통합/E2E 테스트 위주.
> **테스트 도구**: curl, Node.js 스크립트, shell 스크립트, 브라우저 확인만 사용.
> **테스트 자동화**: 각 Step의 테스트를 `scripts/test-step-N.mjs`로 통합. `npm run test:stepN`으로 한 번에 실행.

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

전체 구현을 **4개 Phase**로 나눈다.

```
Phase 1: MVP (Step 1~7) — 로컬 개발 + 배포까지 완전한 블로그
  Step 1: 프로젝트 초기화 & 설정
    ↓
  Step 2: SQLite DB 연결 & 스키마 생성
    ↓
  Step 3: API Routes (AI 포스팅 API)
    ↓
  Step 4: 마크다운 렌더링 파이프라인
    ↓
  Step 5: 프론트엔드 페이지 (SSR)
    ↓
  Step 6: GitHub Actions CI/CD
    ↓
  Step 7: Oracle VM 배포 설정

Phase 2: AI 친화 기능
  - 벌크 포스팅 API (최대 10건: 1GB VM 메모리 예산과 SQLite 트랜잭션 시간 고려)
  - 이미지 포함 포스팅 E2E 흐름 테스트
  - sources 테이블 활용 (ai_model, prompt_hint 기록)
  - 로깅 개선 (API 요청 JSON 로그)

Phase 3: 사용자 편의
  - 전문 검색 UI (FTS5 연동)
  - 커서 기반 페이지네이션
  - 반응형 디자인 개선
  - RSS/Atom 피드

Phase 4: 고급 기능
  - 조회수 통계
  - 북마크/읽음 표시
  - 구독 메일링 (일간/주간 다이제스트 발송, 비MVP)
  - DB 자동 백업 (cron, 7일 보관, 오래된 백업 자동 삭제)
  - 디스크 사용량 모니터링 (80% 이상 알림)
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
  └─ published_at 전이 규칙 ─────────→ Phase 4 (중복 메일 방지)

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
     4) 각 뷰포트에서 경로 점검: `/`, `/posts`, `/write`, `/tags/sample`
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

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 2-1 | 마이그레이션 전략 | 하이브리드 (초기 자동 `CREATE IF NOT EXISTS` + `_migrations` 버전 테이블) | MVP는 자동으로 충분, 향후 ALTER TABLE 대비 |
| 2-2 | DB 파일 위치 | 환경변수 + 기본값 폴백 (`process.env.DATABASE_PATH \|\| path.join(cwd, 'data', 'blog.db')`) | 개발은 설정 없이 동작, 프로덕션은 systemd에서 절대경로 지정 |
| 2-3 | WAL pragma | WAL + `foreign_keys` + `busy_timeout` + `synchronous=NORMAL` + `cache_size=-2000` | 1GB RAM에서 성능+안전성 최적 조합, 캐시 제한으로 메모리 과사용 방지 |
| 2-4 | 네이티브 바인딩 | GitHub Actions(ubuntu) prebuild 의존 + Step 6에서 호환성 검증 | 둘 다 x86_64 Linux, prebuild 바이너리 호환 |
| 2-5 | 메일링 대비 인덱스 | `posts(status, published_at DESC)` 복합 인덱스 선반영 | 일간/주간 다이제스트 후보 조회(`status='published' AND published_at BETWEEN ...`) 최적화 |

> **의존성 영향**: 마이그레이션 → Step 6 배포 시 실행 순서 / DB 위치 → Step 7 systemd 환경변수 / 바인딩 → Step 6 CI 빌드 / 복합 인덱스 → Phase 4 메일링 조회 성능

#### 구현 내용

**2-1. `src/lib/db.ts` — DB 연결 싱글턴**

```ts
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'blog.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');       // 읽기/쓰기 동시 가능
    db.pragma('foreign_keys = ON');        // 외래키 강제
    db.pragma('busy_timeout = 5000');      // 잠금 대기 5초
  }
  return db;
}
```

핵심 포인트:
- WAL 모드: SSR 읽기와 API 쓰기가 동시에 가능
- 싱글턴 패턴: Next.js의 hot reload에서 DB 연결 중복 방지
- `data/` 디렉토리는 gitignore, 배포 시 별도 관리

**2-2. `scripts/migrate.ts` — 스키마 마이그레이션**

```sql
-- posts 테이블
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft', 'published')),
  source_url  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

-- tags 테이블
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- post_tags (다대다)
CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- sources (AI 스크래핑 추적)
CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL UNIQUE,
  post_id     INTEGER REFERENCES posts(id),
  scraped_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ai_model    TEXT,
  prompt_hint TEXT
);

-- FTS5 전문 검색
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, content, content='posts', content_rowid='id'
);

-- FTS 트리거
CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO posts_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_status_published_at ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
```

마이그레이션 실행 방식:
- `scripts/migrate.ts`에서 위 SQL을 `db.exec()`로 실행
- npm script 등록: `"db:migrate": "npx tsx scripts/migrate.ts"`
- 앱 시작 시에도 `getDb()` 호출 시 마이그레이션 자동 실행 (idempotent)

#### 통과 기준 (Gate Criteria)

- 마이그레이션 스크립트 실행 후 `data/blog.db` 파일이 생성된다.
- 모든 테이블(`posts`, `tags`, `post_tags`, `sources`, `schema_versions`, `posts_fts`)이 존재한다.
- WAL 모드가 활성화되어 `blog.db-wal` 파일이 생성된다.
- FTS5 가상 테이블과 트리거가 정상 작동한다.
- CRUD 작업이 실제 DB에서 정상 동작한다.

#### 자동화 실행

```bash
npm run test:step2
```

> `scripts/test-step-2.mjs` — 마이그레이션, 스키마 검증, WAL 모드, CRUD, FTS5, 외래키 CASCADE, CHECK 제약, 멱등성을 한 번에 검증.
> 테스트용 임시 DB(`data/test-blog.db`)를 생성하여 실행 후 자동 삭제. 기존 DB에 영향 없음.

#### 테스트 목록

1. **마이그레이션 실행 & DB 파일 생성**
   ```bash
   npm run db:migrate
   test -f data/blog.db && echo "DB_EXISTS" || echo "DB_MISSING"
   ```
   - 기대 결과: `DB_EXISTS`, 종료 코드 `0`
   - 실패 시: `data/` 디렉토리 존재 여부, better-sqlite3 네이티브 바인딩 빌드 여부

2. **테이블 스키마 검증** (`scripts/test-schema.mjs`)
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   const tables = db.prepare(
     "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
   ).all().map(r => r.name);
   const expected = ['post_tags', 'posts', 'posts_fts', 'schema_versions', 'sources', 'tags'];
   const missing = expected.filter(t => !tables.includes(t));
   if (missing.length > 0) {
     console.error('MISSING TABLES:', missing);
     process.exit(1);
   }
   console.log('ALL TABLES EXIST:', tables);

   const postCols = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
   const requiredCols = ['id','title','slug','content','status','source_url','created_at','updated_at','published_at'];
   const missingCols = requiredCols.filter(c => !postCols.includes(c));
   if (missingCols.length > 0) {
     console.error('MISSING COLUMNS in posts:', missingCols);
     process.exit(1);
   }
   console.log('POSTS COLUMNS OK:', postCols);
   db.close();
   ```
   - 기대 결과: 모든 테이블 및 컬럼 존재 확인

3. **WAL 모드 활성화 확인**
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   const mode = db.pragma('journal_mode', { simple: true });
   console.log('JOURNAL_MODE:', mode);  // 'wal'
   db.close();
   ```
   ```bash
   ls data/blog.db-wal && echo "WAL_EXISTS" || echo "WAL_MISSING"
   ```
   - 기대 결과: journal_mode가 `wal`, `blog.db-wal` 파일 존재

4. **CRUD 통합 테스트** (`scripts/test-crud.mjs`)
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   db.pragma('journal_mode = WAL');
   db.pragma('foreign_keys = ON');

   // CREATE
   const insert = db.prepare(
     `INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`
   );
   const result = insert.run('테스트 글', 'test-post', '# 테스트 내용', 'draft');
   console.log('INSERT id:', result.lastInsertRowid);

   // READ
   const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
   if (post.title !== '테스트 글') throw new Error('READ FAILED');
   console.log('READ OK');

   // UPDATE
   db.prepare('UPDATE posts SET status = ? WHERE id = ?').run('published', result.lastInsertRowid);
   const updated = db.prepare('SELECT status FROM posts WHERE id = ?').get(result.lastInsertRowid);
   if (updated.status !== 'published') throw new Error('UPDATE FAILED');
   console.log('UPDATE OK');

   // DELETE
   db.prepare('DELETE FROM posts WHERE id = ?').run(result.lastInsertRowid);
   const deleted = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
   if (deleted) throw new Error('DELETE FAILED');
   console.log('DELETE OK');

   console.log('ALL CRUD TESTS PASSED');
   db.close();
   ```

5. **FTS5 전문 검색 테스트**
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   db.pragma('journal_mode = WAL');
   db.pragma('foreign_keys = ON');

   db.prepare(`INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`)
     .run('JavaScript 비동기 프로그래밍', 'js-async', 'Promise와 async/await 패턴 설명', 'published');
   db.prepare(`INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`)
     .run('Python 머신러닝 입문', 'python-ml', 'scikit-learn으로 시작하는 ML', 'published');

   const results = db.prepare(
     `SELECT rowid, title FROM posts_fts WHERE posts_fts MATCH ?`
   ).all('JavaScript');
   if (results.length === 0) throw new Error('FTS SEARCH RETURNED NO RESULTS');
   if (!results[0].title.includes('JavaScript')) throw new Error('FTS RESULT MISMATCH');

   db.prepare('DELETE FROM posts').run();
   console.log('FTS5 TEST PASSED');
   db.close();
   ```

6. **외래키 & CASCADE 삭제 테스트**
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   db.pragma('journal_mode = WAL');
   db.pragma('foreign_keys = ON');

   const postId = db.prepare(
     `INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`
   ).run('FK 테스트', 'fk-test', '내용', 'draft').lastInsertRowid;
   const tagId = db.prepare(`INSERT INTO tags (name) VALUES (?)`).run('test-tag').lastInsertRowid;
   db.prepare(`INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)`).run(postId, tagId);

   db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
   const orphan = db.prepare('SELECT * FROM post_tags WHERE post_id = ?').get(postId);
   if (orphan) throw new Error('CASCADE DELETE FAILED');

   db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
   console.log('FOREIGN KEY CASCADE TEST PASSED');
   db.close();
   ```

7. **status CHECK 제약조건 테스트**
   ```js
   import Database from 'better-sqlite3';
   const db = new Database('data/blog.db');
   try {
     db.prepare(`INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)`)
       .run('잘못된 상태', 'bad-status', '내용', 'invalid_status');
     console.error('CHECK CONSTRAINT FAILED: should have thrown');
     process.exit(1);
   } catch (e) {
     console.log('CHECK CONSTRAINT OK:', e.message);
   }
   db.close();
   ```

8. **마이그레이션 멱등성(idempotent) 테스트**
   ```bash
   npm run db:migrate && npm run db:migrate
   echo $?
   ```
   - 기대 결과: 두 번 연속 실행해도 종료 코드 `0`, 에러 없음

#### 피드백 루프

- 이전 단계: better-sqlite3 네이티브 바인딩 빌드 실패 시 Step 1 의존성 설치 재점검
- 다음 단계: 스키마가 올바르지 않으면 Step 3의 모든 API가 실패. FTS5가 동작하지 않으면 Phase 3 검색 기능 불가능.
- 회귀 테스트: Step 3~5 구현 후에도 멱등성 테스트와 CRUD 테스트 재실행

---

### Step 3: API Routes (AI 포스팅 API)

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 3-1 | Slug 한글 처리 | 한글 그대로 유지 (특수문자 제거, 공백→하이픈, 중복 시 `-2` suffix) | 현대 브라우저는 한글 URL 표시. AI 글 제목이 한글이므로 가독성 중요 |
| 3-2 | Rate Limit | 고정 윈도우, `Map<key, {count, resetTime}>`, API Key 기반 분당 10회 | 개인 블로그+AI 클라이언트 1개. IP는 리버스 프록시 뒤에서 부정확 |
| 3-3 | 에러 응답 형식 | `{ error: { code, message, details } }` 실용적 형식 | AI가 `code`로 에러 유형 빠르게 판단, `details`로 필드별 문제 파악 |
| 3-4 | 입력 검증 | Zod | 아키텍처 검증 규칙을 스키마로 1:1 매핑. 서버 전용이라 번들 크기 무관 |
| 3-5 | Bulk API 트랜잭션 | 부분 성공 (개별 Savepoint) — **Phase 2로 이동** | `{ created, errors }` 응답이 부분 성공 전제. AI 토큰 절약 |
| 3-6 | 이미지 업로드 | `request.formData()` + `uploads/YYYY/MM/uuid.ext` + 매직 바이트 직접 구현 | 의존성 0, 허용 타입 4개뿐이므로 라이브러리 과도 |
| 3-7 | source_url 중복 체크 | GET /api/posts/check + POST 409 양쪽 유지 | GET은 AI 토큰 절약(마크다운 생성 전 확인), POST 409는 안전장치 |
| 3-8 | 헬스체크 범위 | DB 연결만 (`SELECT 1`) | 가벼운 체크로 UptimeRobot 빈번한 호출에도 무부하 |
| 3-9 | published_at 전이 규칙 | 최초 발행 시각을 기준값으로 유지 (`draft→published` 시 null이면 now, `published→draft` 시 값 유지) | RSS/메일링이 동일 기준 시각을 사용해 중복 발송/누락 가능성 감소 |

> **의존성 영향**: Slug → Step 5 [slug] 라우팅 / Zod → Step 6 빌드 / 업로드 경로 → Step 7 Caddy root / 헬스체크 → Step 7 UptimeRobot

#### 구현 내용

**3-1. `src/lib/auth.ts` — API Key 검증**

```ts
import { timingSafeEqual } from 'crypto';

export function verifyApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const apiKey = process.env.BLOG_API_KEY ?? '';
  if (token.length !== apiKey.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(apiKey));
}
```

**3-2. Rate Limiting**

인메모리 방식 (별도 의존성 없음):

```ts
// src/lib/rate-limit.ts
// Map<key, { count, resetTime }> 기반
// API Key 기반으로 분당 10회 제한 (IP는 리버스 프록시 뒤에서 부정확할 수 있음)
```

**3-3. API 엔드포인트 구현**

**`POST /api/posts` — 글 생성**

요청:
```json
{
  "title": "글 제목",
  "content": "마크다운 내용",
  "tags": ["tag1", "tag2"],
  "sourceUrl": "https://...",
  "status": "published"
}
```

처리 로직:
1. API Key 검증 → 401
2. Rate limit 체크 → 429
3. 입력 검증 (title: 필수/최대 200자, content: 필수/최대 100,000자, tags: 선택/각 30자/최대 10개, status: draft|published)
4. source_url 중복 체크 → 409 Conflict
5. slug 자동 생성 (title 기반, 중복 시 숫자 suffix)
6. DB 트랜잭션: posts INSERT → tags UPSERT → post_tags INSERT → sources INSERT
7. status가 "published"이면 published_at = now (신규 글 최초 발행 시각 기록)
8. 응답: 201 Created + `{ id, slug }`

**`GET /api/posts/check` — source_url 중복 체크 (선택적)**

- API Key 인증 필요
- 쿼리 파라미터: `?url=https://...`
- 응답: `{ exists: true, postId: N }` 또는 `{ exists: false }`
- AI가 POST 전에 중복을 미리 확인 (토큰 절약). POST 시점에도 서버가 자동 체크하므로 선택적 사용.

**`GET /api/health` — 헬스체크**

- 인증 불필요 (기본), 인증 헤더 포함 시 키 유효성도 검증
- DB에 `SELECT 1` 실행하여 전체 스택 상태 확인
- 응답: `{ status: "ok", db: "connected" }` 또는 500
- 인증 헤더 포함 시: `{ status: "ok", db: "connected", auth: "valid" }` (글쓰기 페이지에서 API Key 검증용)

**`POST /api/uploads` — 이미지 업로드**

- API Key 인증 필요
- MIME 타입 화이트리스트: image/png, image/jpeg, image/webp, image/gif
- 매직 바이트 검증 (파일 시그니처)
- 파일명을 UUID로 교체 (경로 traversal 방지)
- 크기 제한: 5MB
- 응답: `{ url: "/uploads/2025/01/uuid.png" }`

**`GET /api/posts/[id]` — 개별 글 조회**

- 인증 불필요 (공개 API)
- 응답: post 전체 데이터 + tags 배열

**`PATCH /api/posts/[id]` — 글 수정**

- API Key 인증 필요
- 부분 업데이트 지원 (title, content, status, tags)
- status 전이 규칙:
  - `draft -> published`: `published_at`이 null일 때만 현재 시각 설정
  - `published -> draft`: `published_at` 값 유지 (이력 보존)
- updated_at 자동 갱신

**3-4. Slug 생성 유틸리티**

```ts
// src/lib/slug.ts
// 한글 → 그대로 유지 (encodeURIComponent로 URL 안전)
// 영문 → lowercase, 공백 → 하이픈
// 특수문자 제거
// 중복 시 -2, -3 suffix 추가
```

#### 통과 기준 (Gate Criteria)

- dev 서버에서 curl로 모든 API 엔드포인트가 정상 응답한다.
- 인증 없이 보호된 엔드포인트 접근 시 `401`을 반환한다.
- 입력 검증 실패 시 `400`을 반환한다.
- 중복 source_url 전송 시 `409`를 반환한다.
- status 전이 시 `published_at` 규칙(최초 발행 시각 유지)이 지켜진다.
- Rate limit 초과 시 `429`를 반환한다.

#### 자동화 실행

```bash
npm run dev &                  # 개발 서버 시작 (백그라운드)
sleep 5
npm run test:step3             # API 테스트 실행
kill %1                        # 서버 종료
```

> `scripts/test-step-3.mjs` — 개발 서버에 대해 인증, 입력 검증, CRUD, 중복 체크, Rate Limit, E2E 시나리오를 순차 실행.
> 환경변수 `API_KEY`를 `.env.local`에서 자동 로드. 테스트 데이터는 완료 후 자동 정리.

#### 테스트 목록

1. **인증 없이 POST 요청 → 401**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -d '{"title":"test","content":"test"}'
   ```
   - 기대 결과: HTTP `401`

2. **잘못된 API Key로 POST 요청 → 401**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer wrong-key-12345" \
     -d '{"title":"test","content":"test"}'
   ```
   - 기대 결과: HTTP `401`

3. **정상 글 생성 → 201**
   ```bash
   API_KEY="실제키"
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{
       "title": "2026년 AI 뉴스 요약",
       "content": "## 주요 뉴스\n\n- GPT-5 발표\n- Claude 4 출시",
       "tags": ["ai", "news"],
       "sourceUrl": "https://example.com/article-001",
       "status": "published"
     }'
   ```
   - 기대 결과: HTTP `201`, 응답에 `{ "id": <number>, "slug": <string> }`

4. **생성된 글 조회 → 200**
   ```bash
   curl -s -w "\n%{http_code}" http://localhost:3000/api/posts/1
   ```
   - 기대 결과: HTTP `200`, `title`, `content`, `tags` 배열 포함

5. **입력 검증 — title 누락 → 400**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"content": "내용만 있음"}'
   ```
   - 기대 결과: HTTP `400`

6. **입력 검증 — title 200자 초과 → 400**
   ```js
   const longTitle = 'A'.repeat(201);
   const res = await fetch('http://localhost:3000/api/posts', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${process.env.API_KEY}`
     },
     body: JSON.stringify({ title: longTitle, content: '내용' })
   });
   console.log('STATUS:', res.status);  // 400
   ```

7. **입력 검증 — content 100,000자 초과 → 400**
   ```js
   const longContent = 'X'.repeat(100001);
   const res = await fetch('http://localhost:3000/api/posts', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${process.env.API_KEY}`
     },
     body: JSON.stringify({ title: '제목', content: longContent })
   });
   console.log('STATUS:', res.status);  // 400
   ```

8. **입력 검증 — tags 10개 초과 → 400**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{
       "title": "태그 초과",
       "content": "내용",
       "tags": ["t1","t2","t3","t4","t5","t6","t7","t8","t9","t10","t11"]
     }'
   ```
   - 기대 결과: HTTP `400`

9. **입력 검증 — 잘못된 status 값 → 400**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"title":"제목","content":"내용","status":"archived"}'
   ```
   - 기대 결과: HTTP `400`

10. **중복 source_url 체크 → 409**
    ```bash
    # 첫 번째 요청 (성공)
    curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $API_KEY" \
      -d '{"title":"원본 글","content":"내용","sourceUrl":"https://example.com/dup-test"}'

    # 두 번째 요청 (중복 → 409)
    curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $API_KEY" \
      -d '{"title":"중복 글","content":"다른 내용","sourceUrl":"https://example.com/dup-test"}'
    ```
    - 기대 결과: 첫 번째 `201`, 두 번째 `409`

11. **GET /api/posts/check — 중복 URL 체크 API**
    ```bash
    # 존재하는 URL
    curl -s "http://localhost:3000/api/posts/check?url=https://example.com/dup-test" \
      -H "Authorization: Bearer $API_KEY"

    # 존재하지 않는 URL
    curl -s "http://localhost:3000/api/posts/check?url=https://example.com/not-exist" \
      -H "Authorization: Bearer $API_KEY"
    ```
    - 기대 결과: 존재하는 URL → `{ "exists": true, "postId": N }`, 존재하지 않는 URL → `{ "exists": false }`

12. **PATCH /api/posts/[id] — 글 수정**
    ```bash
    curl -s -w "\n%{http_code}" -X PATCH http://localhost:3000/api/posts/1 \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $API_KEY" \
      -d '{"status": "draft"}'

    curl -s http://localhost:3000/api/posts/1
    ```
    - 기대 결과: PATCH → `200`, GET에서 `status`가 `draft`, `updated_at` 갱신, 기존 `published_at` 값 유지

13. **Rate Limit 테스트 → 429**
    ```bash
    for i in $(seq 1 12); do
      CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/posts \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $API_KEY" \
        -d "{\"title\":\"rate-$i\",\"content\":\"내용\"}")
      echo "Request $i: $CODE"
    done
    ```
    - 기대 결과: 처음 10개 `201`, 11번째부터 `429`

14. **존재하지 않는 글 조회 → 404**
    ```bash
    curl -s -w "\n%{http_code}" http://localhost:3000/api/posts/99999
    ```
    - 기대 결과: HTTP `404`

15. **slug 자동 생성 & 중복 처리**
    ```bash
    curl -s -X POST http://localhost:3000/api/posts \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $API_KEY" \
      -d '{"title":"동일 제목 테스트","content":"내용 1"}'

    curl -s -X POST http://localhost:3000/api/posts \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $API_KEY" \
      -d '{"title":"동일 제목 테스트","content":"내용 2"}'
    ```
    - 기대 결과: 두 글의 slug가 다름 (예: `동일-제목-테스트`, `동일-제목-테스트-2`)

16. **전체 흐름 E2E — AI 포스팅 시나리오** (`scripts/test-api-e2e.mjs`)
    ```js
    const API = 'http://localhost:3000';
    const KEY = process.env.API_KEY;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KEY}`
    };

    // 1. 중복 체크
    let res = await fetch(`${API}/api/posts/check?url=https://example.com/e2e-test`, { headers });
    let data = await res.json();
    console.log('1. CHECK:', data.exists);  // false

    // 2. 글 생성
    res = await fetch(`${API}/api/posts`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: 'E2E 테스트 글',
        content: '## E2E\n\n실제 흐름 테스트',
        tags: ['e2e', 'test'],
        sourceUrl: 'https://example.com/e2e-test',
        status: 'published'
      })
    });
    data = await res.json();
    console.log('2. CREATE:', res.status, data);  // 201

    // 3. 조회
    res = await fetch(`${API}/api/posts/${data.id}`, { headers });
    const post = await res.json();
    console.log('3. READ:', post.title, post.tags);

    // 4. 중복 재시도 → 409
    res = await fetch(`${API}/api/posts`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: 'E2E 중복',
        content: '내용',
        sourceUrl: 'https://example.com/e2e-test'
      })
    });
    console.log('4. DUPLICATE:', res.status);  // 409

    // 5. 수정
    res = await fetch(`${API}/api/posts/${data.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'draft' })
    });
    console.log('5. PATCH:', res.status);  // 200

    console.log('E2E TEST PASSED');
    ```

#### 피드백 루프

- 이전 단계: API에서 DB 에러 발생 시 Step 2 스키마/마이그레이션 재점검
- 다음 단계: API가 올바른 JSON 응답을 반환하지 않으면 Step 5의 SSR 페이지가 데이터 렌더링 불가
- 회귀 테스트: Step 4~5 구현 후 `scripts/test-api-e2e.mjs` 재실행

---

### Step 4: 마크다운 렌더링 파이프라인

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 4-1 | rehypeSanitize 스키마 | 최소 허용 원칙: shiki `span[style]`, KaTeX MathML 태그/`katex-*` class, mermaid `data-chart` 허용 | 안전+기능 양립. XSS 차단하면서 렌더링 깨짐 방지 |
| 4-2 | Shiki 테마/언어 | `github-dark` + 핵심 10개 언어 (js, ts, python, bash, json, sql, html, css, md, yaml) | 1GB RAM에서 메모리 절약. 미지원 언어는 일반 텍스트로 표시 |
| 4-3 | Mermaid 변환 | 커스텀 rehype 플러그인 (rehypeShiki 후, rehypeSanitize 전). `data-chart`에 base64 인코딩 | 서버에서 placeholder 생성, 클라이언트에서 렌더링 |
| 4-4 | KaTeX CSS | 로컬 번들 (`import 'katex/dist/katex.min.css'`) | 외부 CDN 의존성 제거, gzip 후 ~25KB로 부담 적음 |

> **의존성 영향**: sanitize 스키마 → Step 5 렌더링 품질 / shiki 언어 수 → Step 7 메모리 / KaTeX CSS → Step 5 layout.tsx / Mermaid 변환 → Step 5 MermaidDiagram 컴포넌트

#### 구현 내용

**4-1. `src/lib/markdown.ts` — 서버 사이드 렌더링**

```
마크다운 원문 (string)
  │
  ▼
unified()
  .use(remarkParse)          ← 마크다운 파싱
  .use(remarkGfm)            ← GFM (취소선, 체크박스, 각주 등)
  .use(remarkMath)           ← 수학 수식 ($...$, $$...$$)
  .use(remarkRehype)         ← HTML 변환
  .use(rehypeShiki, {        ← 코드 하이라이팅
    theme: 'github-dark'
  })
  .use(rehypeKatex)          ← 수식 렌더링
  .use(rehypeSanitize, {     ← XSS 방지 (커스텀 스키마)
    ...defaultSchema,
    // shiki, katex, mermaid가 생성하는 class/style 허용
  })
  .use(rehypeStringify)      ← HTML 출력
  │
  ▼
HTML string (안전)
```

핵심 포인트:
- **rehypeSanitize 커스텀 스키마**: shiki가 생성하는 `style` 속성과 katex가 사용하는 class 허용 필요
- **Mermaid는 서버에서 처리하지 않음**: `` ```mermaid `` 코드 블록을 `<div class="mermaid-container" data-chart="...">` 형태로 변환, 클라이언트에서 렌더링

**4-2. `src/components/MermaidDiagram.tsx` — 클라이언트 렌더링**

```tsx
'use client';
// dynamic import로 mermaid 라이브러리 로드
// data-chart 속성에서 다이어그램 코드를 읽어 렌더링
// 로딩 중 폴백 UI 표시
```

**4-3. KaTeX CSS**

- `src/app/layout.tsx`에서 KaTeX CSS를 `<link>` 또는 import로 포함
- CDN 사용 또는 로컬 번들 (배포 환경에 따라 결정)

#### 통과 기준 (Gate Criteria)

- 각 Tier(1~4)의 마크다운 문법이 올바르게 HTML로 변환된다.
- XSS 위험 요소가 sanitize되어 악성 스크립트가 제거된다.
- shiki 코드 하이라이팅, KaTeX 수식, Mermaid placeholder가 정상 출력된다.
- sanitize 커스텀 스키마가 shiki의 `style`과 KaTeX의 `class`를 허용하면서 악성 입력은 차단한다.

#### 자동화 실행

```bash
npm run test:step4
```

> `scripts/test-step-4.mjs` — Tier 1~4 렌더링, XSS sanitize, shiki style 보존, 대용량 성능 테스트를 한 번에 실행.
> 서버 불필요 (순수 라이브러리 함수 테스트). `src/lib/markdown.ts`를 직접 import하여 테스트.

#### 테스트 목록

1. **Tier 1: 기본 마크다운 렌더링** (`scripts/test-markdown.mjs`)
   ```js
   import { renderMarkdown } from '../src/lib/markdown.ts';

   const input = `# 제목

본문 **볼드** *이탤릭* \`인라인 코드\`

- 항목 1
- 항목 2

1. 순서 1
2. 순서 2

[링크](https://example.com)

![이미지](https://example.com/img.png)

> 인용문

---

| 컬럼1 | 컬럼2 |
|-------|-------|
| 데이터1 | 데이터2 |
`;
   const html = await renderMarkdown(input);

   const checks = [
     ['<h1', '제목 태그'],
     ['<strong', '볼드'],
     ['<em', '이탤릭'],
     ['<code', '인라인 코드'],
     ['<ul', '비순서 목록'],
     ['<ol', '순서 목록'],
     ['<a ', '링크'],
     ['<img ', '이미지'],
     ['<blockquote', '인용문'],
     ['<hr', '수평선'],
     ['<table', '테이블'],
   ];

   let allPassed = true;
   for (const [tag, name] of checks) {
     if (!html.includes(tag)) {
       console.error(`FAIL: ${name} (${tag}) not found`);
       allPassed = false;
     }
   }
   if (allPassed) console.log('TIER 1 ALL PASSED');
   ```

2. **Tier 2: GFM 확장 렌더링**
   ```js
   const input = `
~~취소선~~

- [x] 완료된 할 일
- [ ] 미완료 할 일

https://example.com 자동 링크

각주 참조[^1]

[^1]: 각주 내용
`;
   const html = await renderMarkdown(input);

   const checks = [
     ['<del', '취소선'],
     ['type="checkbox"', '체크박스'],
     ['<a href="https://example.com"', '자동 링크'],
   ];

   let allPassed = true;
   for (const [tag, name] of checks) {
     if (!html.includes(tag)) {
       console.error(`FAIL: ${name} (${tag}) not found`);
       allPassed = false;
     }
   }
   if (allPassed) console.log('TIER 2 ALL PASSED');
   ```

3. **Tier 3: 코드 하이라이팅 (shiki)**
   ```js
   const input = '```javascript\nconst x = 42;\nconsole.log(x);\n```';
   const html = await renderMarkdown(input);

   const hasStyle = html.includes('style=');
   const hasPreCode = html.includes('<pre') && html.includes('<code');

   if (hasStyle && hasPreCode) {
     console.log('TIER 3 PASSED: shiki code highlighting working');
   } else {
     console.error('TIER 3 FAILED');
   }
   ```

4. **Tier 4-1: KaTeX 수식 렌더링**
   ```js
   const input = `인라인 수식: $E = mc^2$

블록 수식:

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$
`;
   const html = await renderMarkdown(input);
   const hasKatex = html.includes('katex') || html.includes('math');

   if (hasKatex) {
     console.log('TIER 4-1 PASSED: KaTeX rendering working');
   } else {
     console.error('TIER 4-1 FAILED');
   }
   ```

5. **Tier 4-2: Mermaid placeholder 변환**
   ```js
   const input = '```mermaid\ngraph TD\n  A --> B\n  B --> C\n```';
   const html = await renderMarkdown(input);

   const hasMermaidContainer = html.includes('mermaid-container') || html.includes('mermaid');
   const hasChartData = html.includes('graph TD') || html.includes('data-chart');

   if (hasMermaidContainer && hasChartData) {
     console.log('TIER 4-2 PASSED: Mermaid placeholder created');
   } else {
     console.error('TIER 4-2 FAILED');
     console.log(html);
   }
   ```

6. **XSS sanitize 검증 — 스크립트 태그 제거**
   ```js
   const malicious = `
# 정상 제목

<script>alert('XSS')</script>

일반 텍스트

<img src=x onerror="alert('XSS')">

<a href="javascript:alert('XSS')">클릭</a>

<div onmouseover="alert('XSS')">호버</div>
`;
   const html = await renderMarkdown(malicious);

   const xssPatterns = ['<script', 'onerror=', 'javascript:', 'onmouseover=', 'alert('];

   let safe = true;
   for (const pattern of xssPatterns) {
     if (html.includes(pattern)) {
       console.error(`XSS FOUND: ${pattern}`);
       safe = false;
     }
   }
   if (!html.includes('<h1') || !html.includes('정상 제목')) {
     console.error('SANITIZE TOO AGGRESSIVE: normal content removed');
     safe = false;
   }

   if (safe) console.log('XSS SANITIZE TEST PASSED');
   else { console.error('XSS SANITIZE TEST FAILED'); process.exit(1); }
   ```

7. **sanitize 커스텀 스키마 — shiki style 보존 확인**
   ```js
   const input = '```python\ndef hello():\n    print("world")\n```';
   const html = await renderMarkdown(input);

   if (html.includes('style=') && html.includes('<pre')) {
     console.log('SHIKI STYLE PRESERVED: PASSED');
   } else {
     console.error('SHIKI STYLE REMOVED BY SANITIZE: FAILED');
   }
   ```

8. **대용량 마크다운 렌더링 성능 테스트**
   ```js
   let bigContent = '# 대용량 테스트\n\n';
   for (let i = 0; i < 500; i++) {
     bigContent += `## 섹션 ${i}\n\n이것은 테스트 문단입니다. `.repeat(10) + '\n\n';
     bigContent += '```javascript\nconsole.log("test");\n```\n\n';
   }

   const start = Date.now();
   const html = await renderMarkdown(bigContent);
   const elapsed = Date.now() - start;

   console.log(`렌더링 시간: ${elapsed}ms, HTML 크기: ${html.length} bytes`);
   if (elapsed < 10000) {
     console.log('PERFORMANCE TEST PASSED');
   } else {
     console.error('PERFORMANCE TEST FAILED: too slow');
   }
   ```

9. **API를 통한 마크다운 저장 및 조회 통합 테스트**
   ```bash
   curl -s -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{
       "title": "마크다운 테스트",
       "content": "# 제목\n\n```python\nprint(\"hello\")\n```\n\n$E=mc^2$",
       "status": "published"
     }'

   # 개별 글 페이지에서 렌더링 확인
   curl -s http://localhost:3000/posts/마크다운-테스트 | grep -c "<pre"
   ```
   - 기대 결과: API 생성 성공, 페이지에서 `<pre` 태그 1개 이상

#### 피드백 루프

- 이전 단계: sanitize가 너무 엄격하면 Step 3에서 저장한 마크다운이 올바르게 렌더링되지 않을 수 있음
- 다음 단계: 렌더링 실패 시 Step 5의 개별 글 페이지가 빈 화면. shiki 메모리 과도 시 Step 7 배포 문제.
- 회귀 테스트: sanitize 스키마 변경 시 XSS 테스트와 shiki style 보존 테스트 반드시 재실행

---

### Step 5: 프론트엔드 페이지 (SSR)

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 5-1 | 페이지네이션 | 오프셋 기반 (`?page=N&per_page=10`) | 글 수백~수천 건 수준. SQLite OFFSET 성능 무관. 페이지 번호 UI 제공 |
| 5-2 | 검색 UI | 폼 제출 방식 (`<form>` → `?q=검색어`) — **Phase 3으로 이동** | 1GB VM 부하 최소화. SSR로 처리, 브라우저 히스토리/북마크 지원 |
| 5-3 | 글 요약(excerpt) | content에서 런타임 추출 (마크다운 문법 제거 후 첫 200자) | DB 변경 없이 가장 단순. 글 수 적어 성능 무관 |
| 5-4 | SSR 캐싱 | On-Demand Revalidation (`revalidatePath` 호출) | 평상시 캐시 서빙(VM 부하↓), 새 글 즉시 반영. **Step 3 API에 역방향 반영 필요** |
| 5-5 | 글쓰기 인증 | API Key를 localStorage에 저장 | 개인 블로그 1인 사용. HTTPS + sanitize XSS 방지. 별도 세션 관리 불필요 |
| 5-6 | 에디터 프리뷰 | `marked` 경량 파서 (~40KB) 클라이언트 렌더링 | 프리뷰 용도. 코드/수식은 placeholder. 실제 렌더링은 저장 후 확인 |
| 5-7 | permalink 안정성 | 외부 공유 링크는 `/posts/[slug]` 단일 규칙으로 고정 | RSS/추후 메일링 본문 링크를 장기적으로 깨지지 않게 유지 |

> **의존성 영향**: 캐싱 → Step 7 메모리 / revalidation → Step 3 POST/PATCH에 `revalidatePath` 추가 (역방향) / permalink 규칙 → Phase 4 메일링 링크 생성 재사용

#### 구현 내용

**5-1. 공통 레이아웃 (`src/app/layout.tsx`)**

- 반응형 네비게이션 (홈, 글 목록, 태그)
- Tailwind CSS 기반
- KaTeX CSS 로드
- 메타데이터 설정

**5-2. 홈 페이지 (`src/app/page.tsx`)**

- 최신 published 글 목록 (최대 10개)
- PostCard 컴포넌트로 렌더링
- DB 쿼리: `SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 10`

**5-3. 글 목록 (`src/app/posts/page.tsx`)**

- 전체 published 글 목록
- 페이지네이션 (오프셋 기반)
- 검색 파라미터: `?page=1`

> 전문 검색(FTS5) UI는 Phase 3에서 추가.

**5-4. 개별 글 (`src/app/posts/[slug]/page.tsx`)**

- SSR로 렌더링
- `src/lib/markdown.ts`로 마크다운 → HTML 변환
- PostContent 컴포넌트: HTML을 `dangerouslySetInnerHTML`로 렌더링
- MermaidDiagram: mermaid 코드 블록이 있으면 클라이언트에서 렌더링
- 메타데이터: title, description (content 첫 200자)
- canonical URL: `${NEXT_PUBLIC_SITE_URL}/posts/[slug]` 규칙으로 통일 (메일링/피드 공유 링크 기준)

**5-5. 태그별 글 목록 (`src/app/tags/[tag]/page.tsx`)**

- 특정 태그가 달린 글 목록
- DB 쿼리: posts JOIN post_tags JOIN tags WHERE tag.name = ?

**5-6. 글쓰기 페이지 (`src/app/write/page.tsx`)**

- Client Component (API 호출, localStorage 접근 필요)
- **인증 흐름**:
  1. 페이지 접속 시 `localStorage`에서 API Key 확인
  2. 없으면 API Key 입력 폼 표시
  3. 입력된 키로 `GET /api/health` 호출하여 유효성 검증 (인증 추가)
  4. 유효하면 `localStorage`에 저장, 에디터 표시
- **에디터 UI**:
  - 좌: `<textarea>` (마크다운 입력)
  - 우: 실시간 프리뷰 (클라이언트 마크다운 렌더링)
  - 상단: title, tags, status(draft/published) 입력 필드
- **글 생성**: `POST /api/posts` 호출 → 성공 시 `/posts/[slug]`로 리다이렉트
- **글 수정**: URL에 `?id=N` 파라미터 → `GET /api/posts/[id]`로 기존 데이터 로드 → `PATCH /api/posts/[id]`로 저장
- **이미지 업로드**: 드래그&드롭 또는 파일 선택 → `POST /api/uploads` → 반환된 URL을 textarea에 마크다운 형식으로 삽입
- **클라이언트 마크다운 프리뷰**: 경량 마크다운 파서 사용 (서버 파이프라인과 100% 동일하지 않아도 됨. 프리뷰 용도)

**5-7. 컴포넌트 상세**

| 컴포넌트 | 역할 | 서버/클라이언트 |
|----------|------|----------------|
| PostCard | 글 카드 (제목, 날짜, 태그, 요약) | Server |
| PostContent | 마크다운 렌더링 결과 표시 | Server |
| MermaidDiagram | Mermaid 다이어그램 클라이언트 렌더링 | Client |
| TagList | 태그 목록 (클릭 시 필터) | Server |
| WriteEditor | 마크다운 에디터 (textarea + 프리뷰 + 이미지 업로드) | Client |

#### 통과 기준 (Gate Criteria)

- 모든 페이지(`/`, `/posts`, `/posts/[slug]`, `/tags/[tag]`, `/write`)가 정상 응답한다.
- 글이 없을 때 빈 상태(empty state) UI가 올바르게 표시된다.
- 페이지네이션이 올바르게 작동한다.
- 네비게이션 링크가 모든 페이지에서 올바르게 동작한다.
- `/write`에서 API Key 인증 후 글 작성/수정이 가능하다.

#### 자동화 실행

```bash
npm run dev &                  # 개발 서버 시작
sleep 5
npm run test:step5             # 프론트엔드 테스트 실행
kill %1                        # 서버 종료
```

> `scripts/test-step-5.mjs` — 페이지 응답, 빈 상태, 글 목록, slug 라우팅, 태그 필터, 페이지네이션, 네비게이션, 메타데이터 등을 HTTP 요청으로 자동 검증.
> 테스트 15, 16 (글쓰기/수정 E2E)은 브라우저 수동 테스트로 별도 실행.

#### 테스트 목록

1. **홈 페이지 응답 테스트**
   ```bash
   curl -s -w "\n%{http_code}" http://localhost:3000/
   ```
   - 기대 결과: HTTP `200`, HTML 응답

2. **홈 페이지 — 빈 상태 표시**
   ```bash
   curl -s http://localhost:3000/ | grep -i "글이 없"
   ```
   - 기대 결과: 빈 상태 메시지 포함 (DB에 published 글이 없는 상태)

3. **홈 페이지 — 최신 글 목록 표시**
   ```bash
   for i in $(seq 1 3); do
     curl -s -X POST http://localhost:3000/api/posts \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer $API_KEY" \
       -d "{\"title\":\"홈 테스트 글 $i\",\"content\":\"내용 $i\",\"status\":\"published\"}"
   done

   curl -s http://localhost:3000/ | grep -c "홈 테스트 글"
   ```
   - 기대 결과: grep 결과 `3`

4. **글 목록 페이지 응답 테스트**
   ```bash
   curl -s -w "\n%{http_code}" http://localhost:3000/posts
   ```
   - 기대 결과: HTTP `200`

5. **개별 글 페이지 — slug로 접근**
   ```bash
   SLUG=$(curl -s -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"title":"개별 글 테스트","content":"## 소제목\n\n본문 내용","status":"published"}' \
     | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).slug))")

   curl -s -w "\n%{http_code}" "http://localhost:3000/posts/$SLUG"
   ```
   - 기대 결과: HTTP `200`, 제목과 본문 포함

6. **개별 글 페이지 — 마크다운 렌더링 확인**
   ```bash
   curl -s "http://localhost:3000/posts/$SLUG" | grep -c "<h2"
   ```
   - 기대 결과: `<h2` 태그 1개 이상

7. **존재하지 않는 slug → 404**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/posts/this-slug-does-not-exist-12345
   ```
   - 기대 결과: HTTP `404`

8. **태그별 글 목록 페이지**
   ```bash
   curl -s -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"title":"태그 필터 테스트","content":"내용","tags":["frontend","react"],"status":"published"}'

   curl -s -w "\n%{http_code}" http://localhost:3000/tags/frontend
   curl -s http://localhost:3000/tags/frontend | grep -c "태그 필터 테스트"
   ```
   - 기대 결과: HTTP `200`, grep 결과 `1` 이상

9. **존재하지 않는 태그 → 빈 목록 또는 404**
   ```bash
   curl -s -w "\n%{http_code}" http://localhost:3000/tags/nonexistent-tag-xyz
   ```
   - 기대 결과: HTTP `200` + 빈 목록 또는 HTTP `404`

10. **draft 글은 목록에 표시되지 않음**
    ```bash
    curl -s -X POST http://localhost:3000/api/posts \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $API_KEY" \
      -d '{"title":"비공개 초안 글","content":"내용","status":"draft"}'

    curl -s http://localhost:3000/ | grep -c "비공개 초안 글"
    curl -s http://localhost:3000/posts | grep -c "비공개 초안 글"
    ```
    - 기대 결과: grep 결과 모두 `0`

11. **페이지네이션 테스트**
    ```js
    // 15개 글 생성 (페이지당 10개 기준)
    for (let i = 0; i < 15; i++) {
      await fetch('http://localhost:3000/api/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.API_KEY}`
        },
        body: JSON.stringify({
          title: `페이지네이션 테스트 ${i}`,
          content: `내용 ${i}`,
          status: 'published'
        })
      });
    }

    const page1 = await (await fetch('http://localhost:3000/posts?page=1')).text();
    const page2 = await (await fetch('http://localhost:3000/posts?page=2')).text();

    const page1Count = (page1.match(/페이지네이션 테스트/g) || []).length;
    const page2Count = (page2.match(/페이지네이션 테스트/g) || []).length;

    console.log(`Page 1: ${page1Count} items, Page 2: ${page2Count} items`);
    if (page1Count > 0 && page2Count > 0 && page1Count + page2Count >= 15) {
      console.log('PAGINATION TEST PASSED');
    }
    ```

12. **네비게이션 링크 검증**
    ```bash
    HTML=$(curl -s http://localhost:3000/)
    echo "$HTML" | grep -c 'href="/"'
    echo "$HTML" | grep -c 'href="/posts"'
    ```
    - 기대 결과: 각 링크 1개 이상

13. **메타데이터(title 태그) 검증**
    ```bash
    curl -s "http://localhost:3000/posts/$SLUG" | grep -o "<title>[^<]*</title>"
    ```
    - 기대 결과: `<title>` 태그에 글 제목 포함

14. **글쓰기 페이지 접근**
    ```bash
    curl -s -w "\n%{http_code}" http://localhost:3000/write
    ```
    - 기대 결과: HTTP `200`, API Key 입력 폼 포함

15. **글쓰기 → 생성 → 리다이렉트 E2E** (브라우저 수동 테스트)
    - `/write` 접속 → API Key 입력 → 제목/내용/태그 작성 → 저장 → `/posts/[slug]`로 이동 확인
    - 기대 결과: 생성된 글이 정상 표시

16. **글 수정 E2E** (브라우저 수동 테스트)
    - `/write?id=N` 접속 → 기존 데이터 로드 확인 → 수정 → 저장
    - 기대 결과: 수정된 내용이 글 페이지에 반영

#### 피드백 루프

- 이전 단계: SSR에서 DB 쿼리 에러 → Step 2 재점검. 렌더링 깨짐 → Step 4 재점검.
- 다음 단계: 페이지 정상 동작해야 Step 6 빌드 성공. SSR 메모리 과도 시 Step 7 OOM 가능.
- 회귀 테스트: Step 6~7 구현 후 curl 기반 페이지 응답 테스트 전부 재실행

---

### Step 6: GitHub Actions CI/CD

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 6-1 | 배포 트리거 | `push to main` + 경로 필터 (`src/**`, `package*.json`, `next.config.*`) + `workflow_dispatch` | 문서 변경 시 불필요한 배포 방지 + 긴급 수동 배포 가능 |
| 6-2 | 네이티브 빌드 | 동일 아키텍처 의존 (ubuntu-latest x86_64) | GitHub Actions와 Oracle VM 모두 x86_64 Linux. prebuild 호환 |
| 6-3 | 아티팩트 전송 | SCP/SSH 직접 전송 (`tar.gz` → `scp` → `ssh systemctl restart`) | 가장 단순. 개인 프로젝트에 rsync 최적화 불필요 |

> **의존성 영향**: 전송 방식(SSH) → Step 7 방화벽 규칙 / 빌드 환경 → Step 7 바이너리 호환성

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
> 테스트 6 (GitHub Actions 실제 실행)은 push 후 `gh run list`로 수동 확인.

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

#### 피드백 루프

- 이전 단계: 빌드 실패 시 Step 1~5의 TypeScript 에러, 의존성 문제 재점검. standalone에 better-sqlite3 미포함 시 `next.config.ts`의 `serverExternalPackages` 확인.
- 다음 단계: 아티팩트가 정상이어야 Step 7에서 VM에 배포 가능.
- 회귀 테스트: 의존성 변경 시마다 아티팩트 무결성 테스트 재실행

---

### Step 7: Oracle VM 배포 설정

> 이 단계는 VM 인스턴스가 준비된 후 진행.

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 7-1 | VM OS | Ubuntu 22.04 Minimal | GitHub Actions와 동일 계열 → 바이너리 호환 확실. 커뮤니티 자료 풍부 |
| 7-2 | Node.js 설치 | NodeSource 공식 apt 리포지토리 | `/usr/bin/node` 고정 경로 → systemd 통합 자연스러움. `apt upgrade`로 보안 패치 |
| 7-3 | 배포 전략 | 심볼릭 링크 교체 (`/opt/blog/releases/버전/` → `/opt/blog/current` symlink) | 1~3초 중단 허용. 롤백은 symlink 변경+restart 한 줄. 블루-그린은 메모리 2배 |
| 7-4 | 롤백 | 이전 3개 릴리즈 보관 → symlink 변경 | `ln -sfn 이전버전 current && systemctl restart blog`로 30초 내 복구 |
| 7-5 | 보안 하드닝 | OCI Security List(포트 제어) + VM 내부 ufw+fail2ban(앱 제어) 이중 레이어 | OCI: 22/80/443 인바운드만. fail2ban: SSH 브루트포스 5회→30분 ban |
| 7-6 | DB 백업 WAL 안전성 | `sqlite3 .backup` 명령 (cp 대신) | WAL 체크포인트 수행 후 일관된 스냅샷 생성. 공식 권장 방식 |

> **의존성 영향**: 보안 하드닝 → Step 6 SSH 배포가 차단되지 않도록 규칙 확인 / 백업 → `sqlite3` CLI 설치 필요

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
    encode gzip
}
```

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

#### 자동화 실행

```bash
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
   curl -s -o /dev/null -w "%{http_code}" https://blog.example.com
   curl -s -I https://blog.example.com | grep -i "strict-transport"
   ```
   - 기대 결과: HTTP `200`, HSTS 헤더 존재

5. **HTTP → HTTPS 리다이렉트** (외부)
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -L http://blog.example.com
   curl -s -o /dev/null -w "%{redirect_url}" http://blog.example.com
   ```
   - 기대 결과: 리다이렉트 URL이 `https://` 시작

6. **외부에서 API 인증 테스트** (외부)
   ```bash
   # 인증 없이 → 401
   curl -s -w "\n%{http_code}" -X POST https://blog.example.com/api/posts \
     -H "Content-Type: application/json" \
     -d '{"title":"test","content":"test"}'

   # 올바른 인증 → 201
   curl -s -w "\n%{http_code}" -X POST https://blog.example.com/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"title":"배포 테스트 글","content":"# 배포 완료\n\nVM에서 작성된 첫 글","status":"published"}'
   ```

7. **외부에서 페이지 접근 테스트** (외부)
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://blog.example.com/
   curl -s -o /dev/null -w "%{http_code}" https://blog.example.com/posts
   curl -s https://blog.example.com/ | grep "배포 테스트 글"
   ```
   - 기대 결과: 모든 페이지 `200`, 생성한 글 표시

8. **방화벽 설정 확인** (VM 내부)
   ```bash
   sudo iptables -L -n | grep -E "22|80|443"
   ```
   - 기대 결과: 22, 80, 443만 허용

9. **메모리 사용량 확인** (VM 내부)
   ```bash
   free -m
   systemctl show blog --property=MemoryCurrent
   ps aux --sort=-%mem | head -10
   ```
   - 기대 결과: 전체 860MB 미만, blog 서비스 400MB 미만

10. **DB 백업 크론잡 테스트** (VM 내부)
    ```bash
    crontab -l | grep "blog.db"
    cp /opt/blog/data/blog.db /opt/blog/backups/blog-$(date +%Y%m%d)-test.db
    ls -la /opt/blog/backups/
    sqlite3 /opt/blog/backups/blog-$(date +%Y%m%d)-test.db "PRAGMA integrity_check;"
    ```
    - 기대 결과: 크론잡 등록 확인, integrity check 결과 `ok`

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
    curl -s -o /dev/null -w "%{http_code}" https://blog.example.com/data/blog.db
    curl -s -o /dev/null -w "%{http_code}" https://blog.example.com/blog.db
    ```
    - 기대 결과: HTTP `404` 또는 `403`

13. **전체 E2E — 외부에서 AI 포스팅 시나리오**
    ```js
    const API = 'https://blog.example.com';
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

#### 피드백 루프

- 이전 단계: VM OOM 시 Step 4 shiki 메모리 최적화 재점검. HTTPS 인증서 실패 시 DNS 확인. standalone 실행 실패 시 Step 6 빌드 재점검.
- 회귀 테스트: 매 배포마다 테스트 13번(전체 E2E) 실행. 메모리 사용량은 기능 추가 시마다 재측정.

---

## Phase 2: AI 친화 기능

> Phase 1 MVP 완료 후 진행.

### 구현 항목

- **POST /api/posts/bulk** — 벌크 포스팅 (최대 10건, 단일 트랜잭션 / 1GB VM 메모리와 처리 시간 고려)
  - 요청: `{ posts: [{ title, content, tags, sourceUrl, status }] }`
  - 응답: `{ created: [{ id, slug }], errors: [{ index, message }] }`
- **이미지 포함 포스팅 E2E 흐름 테스트** — upload → URL 삽입 → 글 생성 전체 흐름 검증
- **sources 테이블 활용** — ai_model, prompt_hint 필드를 POST /api/posts에서 선택적으로 수신
- **로깅 개선** — API 요청 JSON 구조화 로그 (`console.log` + systemd journal)

### 예정 테스트

1. **벌크 포스팅 → 201**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts/bulk \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{
       "posts": [
         {"title": "벌크 글 1", "content": "내용 1", "tags": ["bulk"]},
         {"title": "벌크 글 2", "content": "내용 2", "tags": ["bulk"]},
         {"title": "벌크 글 3", "content": "내용 3", "tags": ["bulk"]}
       ]
     }'
   ```
   - 기대 결과: HTTP `201`, `created` 배열에 3개의 `{ id, slug }`

2. **벌크 포스팅 — 20개 초과 → 400**
   ```js
   const posts = Array.from({ length: 21 }, (_, i) => ({
     title: `벌크 초과 ${i}`, content: `내용 ${i}`
   }));
   const res = await fetch('http://localhost:3000/api/posts/bulk', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${process.env.API_KEY}`
     },
     body: JSON.stringify({ posts })
   });
   console.log('STATUS:', res.status);  // 400
   ```

---

## Phase 3: 사용자 편의

> Phase 2 완료 후 진행.

### 구현 항목

- **전문 검색 UI (FTS5)** — `/posts?q=검색어` 파라미터, SearchBar 컴포넌트 추가
- **커서 기반 페이지네이션** — 오프셋 기반에서 커서 기반으로 전환
- **반응형 디자인 개선** — 모바일 최적화
- **RSS/Atom 피드** — 카테고리별, 태그별 동적 피드 생성

### 예정 테스트

1. **검색 기능 테스트 (FTS5)**
   ```bash
   curl -s -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"title":"Kubernetes 클러스터 관리","content":"kubectl 명령어로 파드를 관리하는 방법","status":"published"}'

   curl -s "http://localhost:3000/posts?q=Kubernetes" | grep -c "Kubernetes"
   ```
   - 기대 결과: grep 결과 `1` 이상

2. **검색 — 결과 없음**
   ```bash
   curl -s "http://localhost:3000/posts?q=존재하지않는검색어12345" | grep -i "결과"
   ```
   - 기대 결과: "검색 결과가 없습니다" 등 빈 상태 메시지

---

## Phase 4: 고급 기능

> Phase 3 완료 후 진행.

### 구현 항목

- **조회수 통계** — 인기 글, 카테고리별 통계, AI 글 vs 직접 쓴 글 구분
- **북마크/읽음 표시** — 사용자 읽은 글 추적, "안 읽은 글만 보기"
- **구독 메일링 (비MVP 확장)** — 일간/주간 다이제스트 발송
  - 구독자 주기(`daily`/`weekly`) 저장
  - `published_at` 구간 조회로 발송 대상 글 선정
  - 발송 이력(구독자+기간) 저장으로 중복 발송 방지
- **DB 자동 백업** — cron, 7일 보관, 오래된 백업 자동 삭제
- **디스크 사용량 모니터링** — 80% 이상 시 알림

---

## 체크리스트

### Phase 1: MVP (Step 1~5 로컬 + Step 6~7 배포)

- [ ] **Step 1**: 프로젝트 초기화
  - [ ] Next.js 프로젝트 생성 (App Router, standalone, TypeScript, Tailwind)
  - [ ] 의존성 설치
  - [ ] 환경변수 설정
  - [ ] 디렉토리 구조 생성
  - [ ] .gitignore 설정

- [ ] **Step 2**: DB 설정
  - [ ] `src/lib/db.ts` — DB 연결 싱글턴
  - [ ] `scripts/migrate.ts` — 스키마 마이그레이션
  - [ ] npm script 등록 (`db:migrate`)
  - [ ] 마이그레이션 실행 테스트

- [ ] **Step 3**: API 구현
  - [ ] `src/lib/auth.ts` — API Key 검증
  - [ ] `src/lib/slug.ts` — Slug 생성
  - [ ] `src/lib/rate-limit.ts` — Rate Limiting
  - [ ] API 에러 응답 포맷 통일 (`{ error, code }`)
  - [ ] `POST /api/posts` — 글 생성 (source_url 중복 시 409)
  - [ ] `GET /api/posts/check` — source_url 중복 체크
  - [ ] `POST /api/uploads` — 이미지 업로드
  - [ ] `GET /api/health` — 헬스체크
  - [ ] `GET /api/posts/[id]` — 글 조회
  - [ ] `PATCH /api/posts/[id]` — 글 수정

- [ ] **Step 4**: 마크다운 렌더링
  - [ ] `src/lib/markdown.ts` — unified 파이프라인
  - [ ] rehypeSanitize 커스텀 스키마
  - [ ] Mermaid 코드 블록 → placeholder 변환
  - [ ] `src/components/MermaidDiagram.tsx` — 클라이언트 렌더링
  - [ ] KaTeX CSS 설정

- [ ] **Step 5**: 프론트엔드 페이지
  - [ ] 공통 레이아웃 (네비게이션, 반응형)
  - [ ] 홈 페이지 (최신 글 목록)
  - [ ] 글 목록 페이지 (오프셋 페이지네이션)
  - [ ] 개별 글 페이지 (마크다운 렌더링)
  - [ ] 태그별 글 목록
  - [ ] 글쓰기/수정 페이지 (API Key 인증, 마크다운 에디터, 이미지 업로드)
  - [ ] PostCard, PostContent, MermaidDiagram, TagList, WriteEditor 컴포넌트

- [ ] **Step 6**: CI/CD 파이프라인
  - [ ] GitHub Actions 워크플로우 작성
  - [ ] GitHub Secrets 설정
  - [ ] 심볼릭 링크 전환 배포 스크립트
  - [ ] 빌드 & 배포 테스트

- [ ] **Step 7**: VM 배포
  - [ ] Oracle VM 프로비저닝
  - [ ] 보안 하드닝 (fail2ban, firewall, SSH 키 인증, OCI Security List)
  - [ ] 서버 초기 설정 (Node.js 22, Caddy, blog 사용자)
  - [ ] systemd 서비스 등록
  - [ ] Caddy 설정
  - [ ] DB 백업 절차 수립
  - [ ] UptimeRobot 모니터링 설정
  - [ ] 도메인 연결 & HTTPS 확인
  - [ ] 롤백 테스트
  - [ ] 엔드투엔드 테스트

### Phase 2: AI 친화 기능

- [ ] POST /api/posts/bulk (최대 10건, 메모리/처리시간 기준)
- [ ] 이미지 포함 포스팅 E2E 흐름 테스트
- [ ] sources 테이블 ai_model, prompt_hint 활용
- [ ] 로깅 개선 (JSON 구조화 로그)

### Phase 3: 사용자 편의

- [ ] 전문 검색 UI (FTS5, SearchBar 컴포넌트)
- [ ] 커서 기반 페이지네이션
- [ ] 반응형 디자인 개선
- [ ] RSS/Atom 피드

### Phase 4: 고급 기능

- [ ] 조회수 통계
- [ ] 북마크/읽음 표시
- [ ] 구독 메일링 (일간/주간 다이제스트, 비MVP)
- [ ] DB 자동 백업 (cron, 7일 보관, 자동 삭제)
- [ ] 디스크 사용량 모니터링 (80% 이상 알림)

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

모든 Step이 완료된 후 전체 회귀 테스트를 한 번에 실행:

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
