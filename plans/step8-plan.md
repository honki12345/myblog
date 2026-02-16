# Step 8 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-16
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`

---

### Step 8: AI 친화 기능

#### 구현 항목

- **POST /api/posts/bulk** — 벌크 포스팅 (최대 10건, 단일 트랜잭션 / 1GB VM 메모리와 처리 시간 고려, 프로젝트 내부 API 계약)
  - 요청: `{ posts: [{ title, content, tags, sourceUrl, status, aiModel?, promptHint? }] }`
  - 응답: `{ created: [{ id, slug }], errors: [{ index, message }] }`
- **이미지 포함 포스팅 E2E 흐름 테스트** — upload → URL 삽입 → 글 생성 전체 흐름 검증
- **sources 테이블 활용** — ai_model, prompt_hint 필드를 POST /api/posts에서 선택적으로 수신
- **로깅 개선** — API 요청 JSON 구조화 로그 (`console.log` + systemd journal)

#### 구현 범위/파일 경계

- `src/app/api/posts/bulk/route.ts` 신규 추가
  - `POST /api/posts/bulk` 라우트 구현
  - 최대 10건 검증, 인증/입력 검증, DB 트랜잭션 처리
  - 각 post 항목의 `aiModel`/`promptHint` optional 입력을 받아 `sources` 메타데이터로 저장
- `src/app/api/posts/route.ts` 확장
  - `aiModel`, `promptHint` 선택 입력 스키마 추가
  - `sources` insert 시 `ai_model`, `prompt_hint` 컬럼 저장
- `src/lib/api-log.ts` 신규 추가 (공통 로깅 유틸)
  - `timestamp`, `route`, `status`, `durationMs` 기준 JSON 로그 출력
  - 개별 API 라우트에서 동일 포맷 재사용

#### 벌크 API 실패 처리 정책

- 정책: **all-or-nothing (단일 트랜잭션)**
- 동작:
  - 모든 항목이 유효하고 저장 가능하면 `201` + `created` 반환
  - 하나라도 실패하면 전체 롤백 후 실패 응답 반환
- 응답 규약:
  - 성공: `{ created: [{ id, slug }], errors: [] }`
  - 실패: `{ created: [], errors: [{ index, message }] }` + HTTP `400/409`
- 상태 코드 규약:
  - `400 INVALID_INPUT`: JSON 형식 오류, 필수 필드 누락, 개수 제한(최대 10건) 위반 등 입력 검증 실패
  - `409 DUPLICATE_SOURCE`: `sourceUrl` 중복(요청 내부 중복 또는 기존 DB 충돌)

#### 레이트 리밋 정책

- `POST /api/posts`(단건): 기존 정책 유지 (`10 req / 60s`)
- `POST /api/posts/bulk`: bulk 전용 별도 정책 적용 (`3 req / 60s`)
- 구현 원칙:
  - 단건/벌크 정책은 독립 카운터로 관리한다.
  - 응답은 기존 규약과 동일하게 `429 RATE_LIMITED` + `retryAfterMs`를 반환한다.

#### 구조화 로그 정책

- 기록 원칙: 요청 바디 원문은 기록하지 않고 요약 정보만 기록한다.
- 필수 로그 키:
  - 공통: `timestamp`, `route`, `status`, `durationMs`
  - 단건/벌크 요청 요약: `postCount`, `contentLengthSum`, `sourceUrlCount`, `payloadHash`
- 민감정보 처리:
  - `Authorization` 헤더 및 토큰은 항상 미기록 또는 마스킹
  - `title`, `content`, `promptHint` 원문 문자열은 로그에 남기지 않음

#### 예정 테스트

1. **벌크 포스팅 → 201**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts/bulk \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $BLOG_API_KEY" \
     -d '{
       "posts": [
         {"title": "벌크 글 1", "content": "내용 1", "tags": ["bulk"]},
         {"title": "벌크 글 2", "content": "내용 2", "tags": ["bulk"]},
         {"title": "벌크 글 3", "content": "내용 3", "tags": ["bulk"]}
       ]
     }'
   ```
   - 기대 결과: HTTP `201`, `created` 배열에 3개의 `{ id, slug }`

2. **벌크 포스팅 — 10개 초과(11개) → 400**
   ```js
   const posts = Array.from({ length: 11 }, (_, i) => ({
     title: `벌크 초과 ${i}`, content: `내용 ${i}`
   }));
   const res = await fetch('http://localhost:3000/api/posts/bulk', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${process.env.BLOG_API_KEY}`
     },
     body: JSON.stringify({ posts })
   });
   console.log('STATUS:', res.status);  // 400
   ```
   - 기대 결과: HTTP `400`, 에러 코드 `INVALID_INPUT`

3. **벌크 원자성 — 부분 실패 시 전체 롤백**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts/bulk \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $BLOG_API_KEY" \
     -d '{
       "posts": [
         {"title": "원자성 A", "content": "ok", "sourceUrl": "https://example.com/atomic-a"},
         {"title": "", "content": "invalid title"},
         {"title": "원자성 C", "content": "ok", "sourceUrl": "https://example.com/atomic-c"}
       ]
     }'
   ```
   ```bash
   sqlite3 data/blog.db "SELECT COUNT(*) FROM posts WHERE source_url IN ('https://example.com/atomic-a','https://example.com/atomic-c');"
   ```
   - 기대 결과: HTTP `400`, 조회 결과 `0` (부분 성공 없이 전량 롤백)

4. **벌크 sourceUrl 중복 — 요청 내/기존 데이터 중복 시 전체 롤백**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts/bulk \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $BLOG_API_KEY" \
     -d '{
       "posts": [
         {"title":"중복 1","content":"ok","sourceUrl":"https://example.com/bulk-dup"},
         {"title":"중복 2","content":"ok","sourceUrl":"https://example.com/bulk-dup"}
       ]
     }'
   ```
   - 기대 결과: HTTP `409`, 에러 코드 `DUPLICATE_SOURCE`, `created=[]`, 중복 관련 `errors` 반환

5. **벌크 동시성 — 동일 sourceUrl 경쟁 요청 검증**
   ```bash
   node --input-type=module <<'EOF'
   const headers = {
     'Content-Type': 'application/json',
     'Authorization': `Bearer ${process.env.BLOG_API_KEY}`
   };
   const body = JSON.stringify({
     posts: [{ title: '경합', content: '내용', sourceUrl: 'https://example.com/bulk-race' }]
   });
   const [a, b] = await Promise.all([
     fetch('http://localhost:3000/api/posts/bulk', { method: 'POST', headers, body }),
     fetch('http://localhost:3000/api/posts/bulk', { method: 'POST', headers, body })
   ]);
   console.log(a.status, b.status);
   EOF
   ```
   - 기대 결과: 하나만 성공(`201`), 나머지는 실패(`409`), 부분 생성 없음

6. **벌크 레이트 리밋 — 3 req/60s 초과 시 429**
   ```bash
   for i in 1 2 3 4; do
     curl -s -o /dev/null -w "try=$i status=%{http_code}\n" \
       -X POST http://localhost:3000/api/posts/bulk \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer $BLOG_API_KEY" \
       -d '{"posts":[{"title":"rate-bulk-'$i'","content":"본문"}]}'
   done
   ```
   - 기대 결과: 1~3회는 `201`, 4회는 `429 RATE_LIMITED`

7. **이미지 포함 포스팅 E2E 흐름 — 업로드 후 게시**
   ```bash
   npm run test:ui -- tests/ui/write-e2e.spec.ts
   ```
   - 기대 결과:
     - `/api/uploads` 업로드 성공 후 에디터에 `![image](/uploads/...)` 삽입
     - 게시 버튼 클릭 시 상세 페이지(`/posts/{slug}`)로 리다이렉트
     - 본문/태그가 상세 페이지에서 노출

8. **sources 메타데이터 저장 — ai_model/prompt_hint 반영**
   ```bash
   curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $BLOG_API_KEY" \
     -d '{
       "title": "메타데이터 저장 테스트",
       "content": "본문",
       "sourceUrl": "https://example.com/step8-meta",
       "status": "published",
       "aiModel": "gpt-5",
       "promptHint": "daily summary"
     }'
   ```
   ```bash
   sqlite3 data/blog.db "SELECT ai_model, prompt_hint FROM sources WHERE url='https://example.com/step8-meta' ORDER BY id DESC LIMIT 1;"
   ```
   - 기대 결과: HTTP `201`, 조회 결과가 `gpt-5|daily summary`

9. **구조화 로그 확인 — 요청 단위 JSON 로그 출력**
   ```bash
   curl -s -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $BLOG_API_KEY" \
     -d '{"title":"로그 테스트","content":"본문","status":"draft"}' >/dev/null

   journalctl -u blog -n 50 --no-pager | grep '"route":"POST /api/posts"'
   ```
   - 전제: 해당 검증은 systemd(`blog.service`)로 실행된 환경에서 수행한다.
   - 기대 결과:
     - `timestamp`, `route`, `status`, `durationMs`, `postCount`, `contentLengthSum`, `sourceUrlCount`, `payloadHash` 키를 포함한 JSON 로그 1건 이상 확인
     - 요청 본문 원문(`title`, `content`, `promptHint`)이 로그에 노출되지 않음

#### 회귀 실행 게이트

- Step 8 전용 자동화 스크립트(`scripts/test-step-8.mjs`)를 추가한다.
- `package.json`에 `test:step8` 스크립트를 등록한다.
- `scripts/test-step-8.mjs` 검증 범위:
  - bulk 성공/실패(10개 제한, 트랜잭션 롤백, 원자성, 중복, 경합, bulk 전용 레이트 리밋)
  - `aiModel`/`promptHint` 저장 검증
  - 구조화 로그 출력 키 검증(로컬은 stdout JSON 파싱, 운영은 journalctl)
- Step 8 기능 변경 완료 후 `npm run test:all`을 반드시 실행한다.
- Step 8 구현 완료 시 `test:all`에 `test:step8`을 즉시 편입하고, 문서/스크립트를 같은 커밋에서 동기화한다.
- `test:all` 통과 후에만 PR 생성/병합/다음 Step 진행을 수행한다.

#### Definition of Done

- 코드:
  - `src/app/api/posts/bulk/route.ts`가 추가되고 bulk API 계약(최대 10건, all-or-nothing, 에러 코드 규약)이 구현됨
  - `src/app/api/posts/route.ts`에 `aiModel`/`promptHint` 수신 및 `sources` 저장 로직이 반영됨
  - `src/lib/api-log.ts`가 추가되고 Step 8 대상 API에서 공통 로그 포맷을 사용함
- 테스트:
  - `npm run test:step8` 통과
  - `npm run test:all` 통과 (`test:step8` 편입 상태 기준)
- 문서:
  - Step 8 구현 결과를 `plans/implementation-plan.md`와 `docs/codebase.md`에 동기화
  - 테스트/운영 규약 변경 시 관련 문서와 스크립트를 같은 커밋에서 갱신
