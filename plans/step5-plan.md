# Step 5 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-15
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`, `plans/step3-plan.md`, `plans/step4-plan.md`

---

## Step 5: 프론트엔드 페이지 (SSR)

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 5-1 | 페이지네이션 | 오프셋 기반 (`?page=N&per_page=10`) | 글 수백~수천 건 수준. SQLite OFFSET 성능 무관. 페이지 번호 UI 제공 |
| 5-2 | 검색 UI | 폼 제출 방식 (`<form>` → `?q=검색어`) — **Phase 3으로 이동** | 1GB VM 부하 최소화. SSR로 처리, 브라우저 히스토리/북마크 지원 |
| 5-3 | 글 요약(excerpt) | content에서 런타임 추출 (마크다운 문법 제거 후 첫 200자) | DB 변경 없이 가장 단순. 글 수 적어 성능 무관 |
| 5-4 | SSR 캐싱 | On-Demand Revalidation (`revalidatePath` 호출) | 평상시 캐시 서빙(VM 부하↓), Route Handler 기준 다음 요청부터 반영(POST 후 리다이렉트 흐름에서는 체감상 즉시). **Step 3 API에 역방향 반영 필요** |
| 5-5 | 글쓰기 인증 | API Key를 localStorage에 저장 | 개인 블로그 1인 사용. HTTPS + sanitize XSS 방지. 별도 세션 관리 불필요 |
| 5-6 | 에디터 프리뷰 | `marked` 경량 파서(버전별 번들 크기 변동 가능) 클라이언트 렌더링 | 프리뷰 용도. 코드/수식은 placeholder. 실제 렌더링은 저장 후 확인 |
| 5-7 | permalink 안정성 | 외부 공유 링크는 `/posts/[slug]` 단일 규칙으로 고정 | RSS/추후 메일링 본문 링크를 장기적으로 깨지지 않게 유지 |

> **의존성 영향**: 캐싱 → Step 7 메모리 / revalidation → Step 3 POST/PATCH에 `revalidatePath` 추가 (역방향) / permalink 규칙 → Phase 4 메일링 링크 생성 재사용
> **운영 주의**: `revalidatePath`는 서버 전용 API로 Route Handler/Server Action에서만 호출한다.

#### 선행 조건 (Preflight)

- 의존성 설치:
  - `npm install marked`
  - `npm install -D @axe-core/playwright`
- 스크립트 등록:
  - `package.json`에 `"test:step5": "node scripts/test-step-5.mjs"` 추가
  - `package.json`의 `test:all`은 Step 5 포함으로 고정한다.
    - 예: `"test:all": "npm run test:step1 && npm run test:step2 && npm run test:step3 && npm run test:step4 && npm run test:step5 && npm run test:ui"`
- Step 5 영향 파일:
  - `src/app/layout.tsx`
  - `src/app/page.tsx`
  - `src/app/posts/page.tsx`
  - `src/app/posts/[slug]/page.tsx`
  - `src/app/tags/[tag]/page.tsx`
  - `src/app/write/page.tsx`
  - `src/components/PostCard.tsx`
  - `src/components/PostContent.tsx`
  - `src/components/TagList.tsx`
  - `src/components/MermaidDiagram.tsx`
  - `scripts/test-step-5.mjs`
  - `scripts/cleanup-test-data.mjs`
  - `tests/ui/*.spec.ts`
  - `playwright.config.ts`
  - `package.json`, `package-lock.json`

#### 구현 착수 체크포인트

- `src/app/page.tsx` Step 1 placeholder 문구를 DB 기반 최신 글 목록으로 교체한다.
- `src/app/posts/page.tsx`의 샘플 데이터 렌더링을 실제 페이지네이션 쿼리 기반으로 교체한다.
- `src/app/posts/[slug]/page.tsx`의 placeholder 상세 렌더링을 실제 slug 조회+404 처리로 교체한다.
- `src/app/tags/[tag]/page.tsx`의 placeholder 화면을 실제 태그 필터 목록으로 교체한다.
- `src/app/write/page.tsx`의 비활성 폼 placeholder를 API Key 인증/작성/수정 가능한 UI로 교체한다.
- `scripts/test-step-5.mjs` placeholder를 Gate Criteria 검증 코드로 교체한다.
- `scripts/cleanup-test-data.mjs` placeholder를 실제 테스트 데이터 정리 로직으로 교체한다.

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
- Playwright UI 테스트에서 최소 뷰포트 `360/768/1440` 스크린샷 비교가 통과한다.
- Playwright 접근성 검사(`@axe-core/playwright`)가 주요 페이지에서 통과한다.

#### 자동화 실행

```bash
export API_KEY="${API_KEY:-$BLOG_API_KEY}" # 테스트 Authorization 헤더용 키 별칭
node scripts/cleanup-test-data.mjs   # 테스트 시작 전 데이터 정리/기준 상태 확보
npm run test:step5             # HTTP 요청 기반 Step 5 검증 (SSR/라우팅/메타데이터)
npm run test:ui                # Playwright UI 회귀 (스크린샷+기능 assertion+접근성)
npm run test:all               # Step 2 이후 회귀 규칙: PR 전 전체 재실행
node scripts/cleanup-test-data.mjs   # 테스트 종료 후 데이터 정리
```

> `scripts/test-step-5.mjs` — 페이지 응답, 빈 상태, 글 목록, slug 라우팅, 태그 필터, 페이지네이션, 네비게이션, 메타데이터 등을 HTTP 요청으로 자동 검증.
> `tests/ui/*.spec.ts` — `/write` 생성/수정 E2E, 뷰포트(360/768/1440) 스크린샷 회귀, 접근성 검사까지 Playwright로 자동 검증.
> Playwright 실패 시 `playwright-report/`, `test-results/`의 screenshot diff/trace/video 아티팩트를 확인한다.

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

9. **존재하지 않는 태그 → 빈 목록(200)**
   ```bash
   curl -s -w "\n%{http_code}" http://localhost:3000/tags/nonexistent-tag-xyz
   ```
   - 기대 결과: HTTP `200` + 빈 목록

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

15. **글쓰기 → 생성 → 리다이렉트 E2E** (Playwright 자동화)
    - `/write` 접속 → API Key 입력 → 제목/내용/태그 작성 → 저장 → `/posts/[slug]` 리다이렉트 검증
    - 기대 결과: 생성된 글 제목/본문/태그가 상세 페이지에 반영

16. **글 수정 E2E** (Playwright 자동화)
    - `/write?id=N` 접속 → 기존 데이터 로드 확인 → 제목/본문 수정 → 저장
    - 기대 결과: 수정된 내용이 상세 페이지에 즉시 반영

17. **뷰포트별 시각 회귀 테스트** (Playwright `toHaveScreenshot`)
    - 뷰포트: `360`, `768`, `1440`
    - 대상 경로: `/`, `/posts`, `/write`, `/tags/sample`
    - 기대 결과: 기준 스냅샷 대비 diff 허용 범위 내

18. **접근성 검사** (`@axe-core/playwright`)
    - 대상 경로: `/`, `/posts`, `/posts/[slug]`, `/write`
    - 기대 결과: 치명/중대 접근성 위반 0건

19. **캐시 무효화 반영 검증** (`revalidatePath`)
    - `POST /api/posts`로 글 생성 직후 `/`, `/posts`, `/posts/[slug]` 재요청
    - 기대 결과: 생성/수정 결과가 다음 요청부터 반영된다.

20. **인증 실패 경로 검증** (API Key 누락/오류)
    - 대상: `POST /api/posts`, `GET/PATCH /api/posts/[id]`, `POST /api/uploads`
    - 기대 결과: HTTP `401` + 표준 에러 응답(`error.code = UNAUTHORIZED`)

21. **이미지 업로드 성공/실패 검증**
    - 성공: png/jpeg/webp/gif 파일 업로드 시 `201` + `url` 반환
    - 실패: 비지원 MIME 또는 5MB 초과 업로드 시 `415`/`413` 반환

22. **Playwright 시각 회귀 실패 아티팩트 검증**
    - 스크린샷 실패 시 `playwright-report/`, `test-results/`에 diff/trace/video 생성 여부 확인
    - 기대 결과: CI/로컬에서 실패 원인 추적 가능 상태 유지

#### 피드백 루프

- 이전 단계: SSR에서 DB 쿼리 에러 → Step 2 재점검. 렌더링 깨짐 → Step 4 재점검.
- 다음 단계: 페이지 정상 동작해야 Step 6 빌드 성공. SSR 메모리 과도 시 Step 7 OOM 가능.
- 회귀 테스트: Step 6~7 구현 후 `npm run test:step5`, `npm run test:ui`, `npm run test:all` 재실행

---
