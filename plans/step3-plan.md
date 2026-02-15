# Step 3 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-14
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`, `plans/step2-plan.md`

---

## Step 3: API Routes (AI 포스팅 API)

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
| 3-10 | 캐시 무효화 | `POST /api/posts`, `PATCH /api/posts/[id]` 완료 시 `revalidatePath` 호출 | Step 5 SSR 캐시 전략의 역의존성 반영. 새 글/수정 글이 즉시 목록/상세에 반영 |

> **의존성 영향**: Slug → Step 5 [slug] 라우팅 / Zod → Step 6 빌드 / 업로드 경로 → Step 7 Caddy root / 헬스체크 → Step 7 UptimeRobot / `revalidatePath` → Step 5 SSR 캐시 일관성

#### 선행 조건 (Preflight)

- 의존성 설치:
  - `npm install zod`
- 스크립트 등록:
  - `package.json`에 `"test:step3": "node scripts/test-step-3.mjs"` 추가
  - Step 3 구현 완료 시 `test:all`에 Step 3 포함:
    - 예: `"test:all": "npm run test:step1 && npm run test:step2 && npm run test:step3"`
- Step 3 영향 파일:
  - `src/lib/auth.ts`
  - `src/lib/slug.ts`
  - `src/lib/rate-limit.ts`
  - `src/app/api/posts/route.ts`
  - `src/app/api/posts/check/route.ts`
  - `src/app/api/posts/[id]/route.ts`
  - `src/app/api/uploads/route.ts` (신규)
  - `src/app/api/health/route.ts`
  - `scripts/test-step-3.mjs`
  - `package.json`, `package-lock.json`

#### 운영 확정값 (관점 5 반영)

- `GET /api/posts/[id]`는 API Key 인증 필수(쓰기 페이지 수정 플로우 전용 API)로 고정한다.
- `GET /api/posts/check` 쿼리 파라미터는 `url` 하나로 고정한다. (`source_url` 별칭 미지원)
- `published_at`, `created_at`, `updated_at`은 SQLite `datetime('now')` 기준 UTC 문자열로 저장한다.
- `PATCH /api/posts/[id]`에서 title이 변경되어도 slug는 변경하지 않는다. (permalink 안정성 유지)
- `source_url` 중복 정책은 `posts.source_url` 기준 전체 상태(draft/published 공통)에서 단일 유니크로 처리한다.
- 동시성 경합에서는 `sources.url` UNIQUE 제약 위반을 `409 DUPLICATE_SOURCE`로 매핑해 중복 저장을 차단한다.
- Rate Limit 키는 원문 API Key를 메모리에 직접 보관하지 않고 해시(`sha256`)를 사용한다.

#### 구현 착수 체크포인트

- `src/app/api/posts/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/app/api/posts/check/route.ts`, `src/app/api/health/route.ts`의 placeholder 응답을 제거한다.
- `src/app/api/uploads/route.ts` 파일을 새로 생성한다.
- `scripts/test-step-3.mjs` placeholder를 실제 Gate Criteria 검증 코드로 교체한다.
- `src/lib/slug.ts`의 영문 전용 slug 규칙을 Step 3 결정(한글 유지)과 일치하게 교체한다.
- `src/lib/rate-limit.ts` 기본 제한값을 Step 3 정책(분당 10회)과 일치시킨다.
- `src/app/api/posts/check/route.ts`의 쿼리 파라미터/응답 키를 `url`, `exists` 기준으로 통일한다.
- 위 항목 완료 후 Gate 테스트(`npm run test:step3`, `npm run test:all`)를 실행한다.

#### 구현 내용

**3-1. `src/lib/auth.ts` — API Key 검증**

```ts
import { timingSafeEqual } from 'crypto';

export function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export function verifyApiKey(input: string | null | undefined): boolean {
  const apiKey = process.env.BLOG_API_KEY ?? '';
  if (!input) return false;
  const tokenBuffer = Buffer.from(input);
  const apiKeyBuffer = Buffer.from(apiKey);
  if (tokenBuffer.length !== apiKeyBuffer.length) {
    return false;
  }
  return timingSafeEqual(tokenBuffer, apiKeyBuffer);
}
```

**3-2. Rate Limiting**

인메모리 방식 (별도 의존성 없음):

```ts
// src/lib/rate-limit.ts
// Map<key, { count, resetTime }> 기반
// key는 API Key 원문 대신 sha256 hash 사용
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
9. `revalidatePath('/')`, `revalidatePath('/posts')`, `revalidatePath(\`/posts/${slug}\`)` 실행

**`GET /api/posts/check` — source_url 중복 체크 (선택적)**

- API Key 인증 필요
- 쿼리 파라미터: `?url=https://...`
- 응답: `{ exists: true, postId: N }` 또는 `{ exists: false }`
- AI가 POST 전에 중복을 미리 확인 (토큰 절약). POST 시점에도 서버가 자동 체크하므로 선택적 사용.

**`GET /api/health` — 헬스체크**

- 인증 불필요 (기본), 인증 헤더 포함 시 키 유효성도 검증
- DB에 `SELECT 1` 실행하여 전체 스택 상태 확인
- Route Handler에서 `export const dynamic = 'force-dynamic'` 명시해 항상 최신 상태를 확인
- 응답: `{ status: "ok", db: "connected" }` 또는 500
- 인증 헤더 포함 시: `{ status: "ok", db: "connected", auth: "valid" }` (글쓰기 페이지에서 API Key 검증용)
- 인증 헤더가 포함됐는데 키가 유효하지 않으면 `401` 반환 (`UNAUTHORIZED`)

**`POST /api/uploads` — 이미지 업로드**

- `src/app/api/uploads/route.ts` 신규 구현
- API Key 인증 필요
- MIME 타입 화이트리스트: image/png, image/jpeg, image/webp, image/gif
- 매직 바이트 검증 (파일 시그니처)
- 파일명을 UUID로 교체 (경로 traversal 방지)
- 크기 제한: 5MB
- 응답: `{ url: "/uploads/2025/01/uuid.png" }`

**`GET /api/posts/[id]` — 개별 글 조회**

- API Key 인증 필요 (쓰기 페이지 수정 플로우 전용 API)
- 응답: post 전체 데이터 + tags 배열

**`PATCH /api/posts/[id]` — 글 수정**

- API Key 인증 필요
- 부분 업데이트 지원 (title, content, status, tags)
- title 변경 시 slug는 기존 값을 유지한다. (불변 permalink)
- status 전이 규칙:
  - `draft -> published`: `published_at`이 null일 때만 현재 시각 설정
  - `published -> draft`: `published_at` 값 유지 (이력 보존)
  - `published -> published`: `published_at` 기존 값 유지
- updated_at 자동 갱신

**3-4. Slug 생성 유틸리티**

```ts
// src/lib/slug.ts
// 한글 → 그대로 유지 (encodeURIComponent로 URL 안전)
// 영문 → lowercase, 공백 → 하이픈
// 특수문자 제거
// 중복 시 -2, -3 suffix 추가
```

#### 리스크 및 대응

- 인메모리 Rate Limit은 프로세스 재시작 시 초기화된다.
  - 대응: 운영 전제(단일 인스턴스)로 유지하되, Phase 2에서 Redis 기반으로 확장 가능하도록 인터페이스를 분리한다.
- SQLite 단일 writer 제약으로 쓰기 피크 시 지연이 발생할 수 있다.
  - 대응: `busy_timeout`을 유지하고, Step 3 테스트에서 동시 요청 시나리오를 추가한다.
- 업로드 파일이 디스크를 빠르게 점유할 수 있다.
  - 대응: 파일 크기 제한(5MB) + MIME/매직바이트 검증 + 월별 디렉토리 분리로 운영 정리 기준을 마련한다.

#### 범위 경계 (Out of Scope)

- `POST /api/posts/bulk`는 Phase 2 범위로 유지한다.
- `DELETE /api/posts/[id]`는 Step 3 범위에서 구현하지 않는다.
- 인증 체계를 세션/계정 기반 로그인으로 확장하는 작업은 Step 3 범위에서 제외한다.

#### 통과 기준 (Gate Criteria)

- dev 서버에서 curl로 모든 API 엔드포인트가 정상 응답한다.
- 인증 없이 보호된 엔드포인트 접근 시 `401`을 반환한다.
- 입력 검증 실패 시 `400`을 반환한다.
- 중복 source_url 전송 시 `409`를 반환한다.
- status 전이 시 `published_at` 규칙(최초 발행 시각 유지)이 지켜진다.
- Rate limit 초과 시 `429`를 반환한다.

#### 완료 정의 (Definition of Done)

- `npm run test:step3`가 종료 코드 `0`으로 완료된다.
- `npm run test:all`이 Step 3 포함 구성으로 종료 코드 `0`을 반환한다.
- `POST /api/posts`, `GET /api/posts/check`, `GET/PATCH /api/posts/[id]`, `POST /api/uploads`, `GET /api/health`가 Gate Criteria를 만족한다.
- placeholder 응답(`501`, `not implemented`)이 Step 3 범위 API에서 제거된다.

#### 자동화 실행

```bash
npm run test:step3             # (스크립트 내부 dev 서버 자동 시작/종료)
npm run test:all               # 회귀 규칙: Step 2 이후 전체 재검증
```

> `scripts/test-step-3.mjs` — 개발 서버에 대해 인증, 입력 검증, CRUD, 중복 체크, Rate Limit, E2E 시나리오를 순차 실행.
> 환경변수 `API_KEY`를 `.env.local`에서 자동 로드. 테스트 데이터는 완료 후 자동 정리.
> 회귀 규칙: Step 2 이후 기능 변경은 `test:step3` 통과 후 `npm run test:all`까지 통과해야 완료로 간주.

#### 실패/복구 절차

1. `npm run test:step3` 실패 시 실패 케이스를 단건 재실행해 원인을 분리한다.
2. Rate Limit 관련 실패는 테스트 간 상태 오염 가능성이 있으므로 프로세스를 재시작한 뒤 재실행한다.
3. DB 상태 오염이 의심되면 테스트 데이터 정리 스크립트를 실행하고 재검증한다.
4. 수정 후 `npm run test:step3`부터 다시 실행하고, 통과 시 `npm run test:all`을 재실행한다.

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
   curl -s -w "\n%{http_code}" http://localhost:3000/api/posts/1 \
     -H "Authorization: Bearer $API_KEY"
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

    curl -s http://localhost:3000/api/posts/1 \
      -H "Authorization: Bearer $API_KEY"
    ```
    - 기대 결과: PATCH → `200`, GET에서 `status`가 `draft`, `updated_at` 갱신, 기존 `published_at` 값 유지, slug 값 불변

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
    curl -s -w "\n%{http_code}" http://localhost:3000/api/posts/99999 \
      -H "Authorization: Bearer $API_KEY"
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

16. **전체 흐름 E2E — AI 포스팅 시나리오** (`scripts/test-step-3.mjs` 내부 포함)
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
- 회귀 테스트: Step 4~5 구현 후 `npm run test:step3` + `npm run test:all` 재실행

---
