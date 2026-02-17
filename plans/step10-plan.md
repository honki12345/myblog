# Step 10 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-17
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`, `plans/step2-plan.md`, `plans/step5-plan.md`

---

### Step 10: 전문 검색 UI (FTS5)

#### 목표

- `/posts?q=검색어` 형태로 글 목록을 전문 검색(FTS5) 결과로 필터링한다.
- 공개 사용자는 `published`만 검색된다.
- 관리자 세션이 있으면 `draft` + `published`가 모두 검색된다.
- 검색어 입력 UI(SearchBar)를 제공하고, 검색 상태를 유지/초기화할 수 있어야 한다.
- FTS5 구문 오류 등으로 500이 나지 않도록 방어한다.

#### 구현 항목

- **검색 파라미터 추가**
  - `src/app/posts/page.tsx`에서 `searchParams.q` 파싱/정규화(공백 trim, 길이 제한).
  - `page`, `per_page` 링크 생성 시 `q`를 유지한다.
- **DB 검색 쿼리 추가 (FTS5)**
  - `posts_fts MATCH ?`를 사용해 `posts`와 조인하여 결과를 조회한다.
  - 정렬은 Step 11 정책과 동일하게 `COALESCE(published_at, created_at) DESC, id DESC`를 유지한다.
  - `COUNT(*)`도 동일 조건으로 산출해 페이지네이션에 사용한다.
  - FTS5 구문 오류(예: 따옴표 미닫힘) 발생 시 “검색어가 올바르지 않습니다” 메시지로 처리한다.
- **검색 UI 추가**
  - `src/components/SearchBar.tsx` 신규.
  - 서버 컴포넌트 기반 GET 폼으로 구현(불필요한 클라이언트 JS 회피).
  - `q`가 있을 때 초기화 링크(`/posts`) 제공.
- **빈 상태 UI**
  - `q`가 있을 때 결과가 없으면 “검색 결과가 없습니다” 메시지를 표시한다.
  - `q`가 없고 글이 없을 때는 기존 “아직 글이 없습니다” 메시지를 유지한다.

#### 구현 범위/파일 경계

- `src/app/posts/page.tsx`
  - `searchParams` 타입에 `q?: string` 추가
  - 검색/기본 목록 분기 및 쿼리/카운트 로직 추가
  - 페이지네이션 링크에 `q` 보존
- `src/components/SearchBar.tsx` (신규)

#### 검색 정책(정규화/제한)

- `q`는 `trim()` 후, 빈 문자열이면 검색 모드 해제(기본 목록).
- `q` 길이는 최대 100자로 제한(초과분은 잘라내거나 에러 메시지로 처리 중 택1).
- 검색어는 파라미터 바인딩으로 전달한다(문자열로 SQL injection 방지).
  - 단, FTS 쿼리 파서는 “구문”으로 해석하므로 구문 오류는 try/catch로 UX 처리한다.

#### SQL 스케치

1. 총 개수
   ```sql
   SELECT COUNT(*) AS count
   FROM posts p
   JOIN posts_fts f ON f.rowid = p.id
   WHERE p.status IN (?, ?)
     AND posts_fts MATCH ?;
   ```

2. 페이지 조회
   ```sql
   SELECT
     p.id,
     p.slug,
     p.title,
     p.content,
     p.status,
     p.published_at,
     p.updated_at,
     COALESCE(GROUP_CONCAT(t.name, char(31)), '') AS tags_csv
   FROM posts p
   JOIN posts_fts f ON f.rowid = p.id
   LEFT JOIN post_tags pt ON pt.post_id = p.id
   LEFT JOIN tags t ON t.id = pt.tag_id
   WHERE p.status IN (?, ?)
     AND posts_fts MATCH ?
   GROUP BY p.id
   ORDER BY COALESCE(p.published_at, p.created_at) DESC,
            p.id DESC
   LIMIT ? OFFSET ?;
   ```

> 주의: `posts_fts`는 Step 2에서 `content='posts'` + 트리거로 유지되므로 별도 마이그레이션은 필요 없다.

#### 비범위(Out of Scope)

- 결과 하이라이트(snippet)
- 자동완성/추천 검색어
- 태그/카테고리/상태의 복합 필터 UI

#### 권장 구현 순서

1. `src/app/posts/page.tsx`에 `q` 파라미터 파싱/정규화 추가
2. FTS5 기반 `loadTotalPosts`, `loadPosts` 확장 및 오류 방어(구문 오류)
3. `src/components/SearchBar.tsx` 추가 및 `/posts` 헤더에 배치
4. 빈 상태 UI 분기 추가
5. Step 10 테스트를 `scripts/test-step-10.mjs`로 자동화하고 `test:all`에 편입(선택)

#### 예정 테스트

1. **검색 기능 테스트 (FTS5)**
   ```bash
   curl -s -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $BLOG_API_KEY" \
     -d '{"title":"Kubernetes 클러스터 관리","content":"kubectl 명령어로 파드를 관리하는 방법","status":"published"}'

   curl -s "http://localhost:3000/posts?q=Kubernetes" | grep -c "Kubernetes"
   ```
   - 기대 결과: grep 결과 `1` 이상

2. **검색 — 결과 없음**
   ```bash
   curl -s "http://localhost:3000/posts?q=존재하지않는검색어12345" | grep -i "검색 결과"
   ```
   - 기대 결과: "검색 결과가 없습니다" 등 빈 상태 메시지

3. **검색 — FTS5 구문 오류 방어**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/posts?q=%22unclosed"
   ```
   - 기대 결과: HTTP `200` (500 금지), 페이지 내에 “검색어가 올바르지 않습니다” 등의 메시지
