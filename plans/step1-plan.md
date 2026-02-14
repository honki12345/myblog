# Step 1 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-14

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
- 회귀 테스트: Step 2 완료 이후에는 각 Step 구현/수정 종료 시마다 `npm run test:all` 재실행을 기본으로 하고, 초기 구성 구간에서는 `npm run build`와 가능한 Step 테스트를 순차 실행

---
