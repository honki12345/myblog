# Step 11 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-17
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`, `plans/step5-plan.md`, `plans/step10-plan.md`

---

### Step 11: 커서 기반 페이지네이션 전환

#### 목표

- `/posts`의 오프셋 기반 페이지네이션(`?page=N&per_page=M`)을 **커서 기반(keyset) 페이지네이션**으로 전환한다.
- 정렬 기준은 기존과 동일하게 `COALESCE(published_at, created_at) DESC, id DESC`를 유지한다.
- 공개 사용자는 `published`만, 관리자 세션이 있으면 `draft` + `published`를 모두 포함한다.
- Step 10의 검색 파라미터(`q`)가 존재하는 경우에도 동일한 커서 규약으로 동작해야 한다(검색 상태 유지).
  - `q`는 결과 집합 필터만 담당하며, 정렬/커서 기준은 기본 목록과 동일하게 유지한다.
- URL만으로 다음/이전 페이지 이동이 가능해야 한다(클라이언트 상태 없이).
- 잘못된 커서/파라미터로 500이 나지 않도록 방어한다.

#### URL/쿼리 파라미터 계약

- `page`: (legacy) 오프셋 기반 페이지네이션 파라미터 — Step 11에서는 정규화 redirect로 제거한다.
- `per_page`: 페이지 크기 (기본 10, 최대 50) — 기존 유지
- `after`: 다음(더 오래된 글) 페이지 커서
- `before`: 이전(더 최신 글) 페이지 커서
- `q`: (Step 10) 검색어 — 존재 시 페이지네이션 링크에 유지

규칙:

- `after`와 `before`는 동시에 올 수 없다.
  - 동시 입력 시 `/posts`로 정규화 redirect (`q`, `per_page`만 보존).
- `page`는 Step 11 이전(오프셋 기반) 레거시 파라미터다.
  - 입력 시 `/posts`로 정규화 redirect (`q`, `per_page`만 보존).
- `after/before`는 base64url(JSON) 토큰이다.
- 커서 payload는 `{ sortKey: string; id: number }`로 고정한다.
  - `sortKey`: `COALESCE(published_at, created_at)` 결과 문자열 (`YYYY-MM-DD HH:MM:SS`)
  - `id`: tie-breaker (내림차순 정렬의 2차 키)
  - `q`, `per_page` 등 필터/표시 컨텍스트는 payload에 포함하지 않는다.

#### 커서 인코딩/검증

- 인코딩: `JSON.stringify(payload)` → UTF-8 → base64url
- 디코딩/검증:
  - 길이 제한(예: 300자)
  - base64url decode 실패/JSON parse 실패/필드 타입 불일치 시 invalid
  - invalid인 경우 `/posts`(필요 시 `q`, `per_page`만 보존)로 redirect

> 커서 payload에는 민감정보가 포함되지 않는다. 목적은 “정렬 기준 상의 마지막 항목”을 안전하게 전달하는 것이다.

#### SQL 스케치 (Keyset Pagination)

공통 정렬 키:

- `sort_key = COALESCE(p.published_at, p.created_at)`
- 커서 생성용으로 `sort_key`를 만들기 위해 쿼리에서 아래 중 하나를 반드시 조회한다.
  - `p.created_at`도 함께 SELECT해서 애플리케이션에서 `published_at ?? created_at`로 `sortKey`를 계산
  - 또는 `COALESCE(p.published_at, p.created_at) AS sort_key`를 SELECT해서 그대로 사용

1. 첫 페이지(커서 없음) / 다음 페이지(`after`)

```sql
-- after가 있으면 아래 AND 절을 추가한다.
AND (
  sort_key < ? OR (sort_key = ? AND p.id < ?)
)
ORDER BY sort_key DESC, p.id DESC
LIMIT ?; -- 실제 구현에서는 limit+1로 조회해 hasNext를 판정한다.
```

2. 이전 페이지(`before`)

```sql
-- before: 더 최신 글을 조회한다.
AND (
  sort_key > ? OR (sort_key = ? AND p.id > ?)
)
ORDER BY sort_key ASC, p.id ASC
LIMIT ?; -- limit+1로 조회한 뒤, 결과를 역순으로 뒤집어 렌더링한다.
```

> 주의: `sort_key` alias는 WHERE에서 사용할 수 없으므로 실제 쿼리에서는 `COALESCE(p.published_at, p.created_at)`를 반복해서 사용한다.

#### 인덱스/마이그레이션

Step 11에서는 keyset 페이지네이션 쿼리의 정렬/필터를 안정적으로 태울 수 있도록 expression index를 추가하는 것을 권장한다.

```sql
CREATE INDEX IF NOT EXISTS idx_posts_status_sort_key_id
  ON posts(status, COALESCE(published_at, created_at) DESC, id DESC);
```

- 주의: SQLite의 expression index는 쿼리에서 **동일한 표현식**을 사용할 때 플래너가 고려한다.
  - 예: 위 인덱스를 추가했다면 `ORDER BY`/`WHERE`에서도 `COALESCE(published_at, created_at)`를 그대로 사용하고 `datetime(...)` 등으로 감싸지 않는다.
- `schema_versions` 버전을 4로 상향하고 Step 11 마이그레이션으로 포함한다. (현재 3까지 사용 중)

#### UI 변경 (/posts)

- 페이지 번호 UI는 제거하고, **커서 기반 이전/다음 내비게이션**으로 전환한다.
  - `이전`: `before=<cursor(firstItem)>` (더 최신 글)
  - `다음`: `after=<cursor(lastItem)>` (더 오래된 글)
  - `최신`: `/posts` (커서만 초기화)
    - `q`, `per_page`는 보존하고, `after/before`만 제거한다.
- `aria-label="페이지네이션"`은 유지한다.
- `per_page`, `q`는 모든 페이지네이션 링크에 보존한다.
- 헤더의 “1-10 / 총 N개” 형태는 cursor 모드와 맞지 않으므로 `총 N개의 글`만 표시한다.
  - `N`은 status/q 동일 조건의 `COUNT(*)`로 산출한다.

- `hasNext/hasPrev` 버튼 활성화 판정 규칙:
  - 조회 방향(커서 종류)에 대해 `LIMIT(per_page + 1)`로 1개를 더 가져와 "그 방향으로 더 있음"을 판정한다.
    - `after`(더 오래된 글) 조회: 초과분이 있으면 `hasNext=true` (다음 버튼 활성)
    - `before`(더 최신 글) 조회: 초과분이 있으면 `hasPrev=true` (이전 버튼 활성)
  - 반대 방향은 `SELECT 1 ... LIMIT 1` 존재 체크로 판정한다. (딥링크/수동 커서에도 안전)
    - 예: 현재 페이지의 `firstItem`에 대해 "더 최신 글 존재" 여부는 `firstItem`보다 큰(`>`) 조건으로 1건이라도 있는지 확인한다.
    - 예: 현재 페이지의 `lastItem`에 대해 "더 오래된 글 존재" 여부는 `lastItem`보다 작은(`<`) 조건으로 1건이라도 있는지 확인한다.

#### 구현 범위/파일 경계

- `/posts` 렌더링/쿼리
  - `src/app/posts/page.tsx`
- (권장) 커서 encode/decode 유틸
  - `src/lib/cursor.ts` (신규) 또는 `src/app/posts/page.tsx` 내부 로컬 함수
- (권장) DB 마이그레이션 (인덱스 추가)
  - `src/lib/db.ts`
- Step 11 자동화 테스트
  - `scripts/test-step-11.mjs` (신규)
  - `package.json`에 `test:step11` 등록
  - `scripts/test-all.mjs`에 `test:step11` 편입
  - 실행 순서(권장): `test:step5` 직후, `test:ui` 이전
- 회귀 영향(기존 테스트 갱신 필요)
  - `scripts/test-step-5.mjs` (페이지네이션 테스트 케이스를 cursor 기반으로 갱신)
    - 기존 `/posts?page=1`, `/posts?page=2` 호출은 제거한다. (Step 11에서 `page`는 정규화 redirect 대상)
    - `/posts` 첫 페이지 응답 HTML에서 "다음" 링크(`after=...`)의 `href`를 추출해 2페이지를 요청한다.
    - 1페이지 + 2페이지에서 시드로 생성한 15개 글이 중복/누락 없이 모두 등장함을 검증한다.
  - `tests/ui/visual-regression.spec.ts` (페이지네이션 UI 변경에 따른 스냅샷 갱신 가능)

#### 권장 구현 순서

1. 커서 payload/encode/decode 정책 확정 및 invalid 처리(redirect) 구현
2. `/posts` 기본 목록을 keyset 쿼리로 전환하고 `after`로 다음 페이지 이동 지원
3. `before`를 추가해 이전 페이지 이동까지 지원(ASC 조회 + reverse)
4. 인덱스 마이그레이션 추가(필요 시 `EXPLAIN QUERY PLAN`으로 확인)
5. Step 11 테스트(`scripts/test-step-11.mjs`) 추가 + `test:all` 편입
6. 회귀 테스트 갱신(`scripts/test-step-5.mjs`, Playwright 스냅샷) 및 `npm run test:all` 통과 확인

#### 예정 테스트

> 테스트 헬퍼 컨벤션: `export API_KEY="${API_KEY:-$BLOG_API_KEY}"`

1. **다음 페이지(after)로 3페이지 이상 이동해도 중복/누락이 없다**
2. **이전 페이지(before)로 되돌아가면 원래 페이지와 동일한 항목이 노출된다**
3. **`per_page` 상한(50)과 기본값(10)이 유지된다**
4. **invalid cursor 입력 시 500이 아닌 redirect 또는 정상 렌더링으로 방어된다**
5. **(Step 10 연동) `q`가 있을 때도 페이지네이션 링크가 `q`를 보존한다**

#### 비범위(Out of Scope)

- 무한 스크롤(infinite scroll)
- “마지막 페이지로” 이동(끝 커서 탐색)
- 페이지 번호 UI 유지 (cursor 모드에서는 제공하지 않음)
