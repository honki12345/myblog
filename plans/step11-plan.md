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
- URL만으로 다음/이전 페이지 이동이 가능해야 한다(클라이언트 상태 없이).
- 잘못된 커서/파라미터로 500이 나지 않도록 방어한다.

#### URL/쿼리 파라미터 계약

- `per_page`: 페이지 크기 (기본 10, 최대 50) — 기존 유지
- `after`: 다음(더 오래된 글) 페이지 커서
- `before`: 이전(더 최신 글) 페이지 커서
- `q`: (Step 10) 검색어 — 존재 시 페이지네이션 링크에 유지

규칙:

- `after`와 `before`는 동시에 올 수 없다.
  - 동시 입력 시 `/posts`로 정규화 redirect (권장) 또는 400 처리 중 택1.
- `after/before`는 base64url(JSON) 토큰이다.
- 커서 payload는 `{ sortKey: string; id: number }`로 고정한다.
  - `sortKey`: `COALESCE(published_at, created_at)` 결과 문자열 (`YYYY-MM-DD HH:MM:SS`)
  - `id`: tie-breaker (내림차순 정렬의 2차 키)

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

- `schema_versions` 버전을 4로 상향하고 Step 11 마이그레이션으로 포함한다. (현재 3까지 사용 중)

#### UI 변경 (/posts)

- 페이지 번호 UI는 제거하고, **커서 기반 이전/다음 내비게이션**으로 전환한다.
  - `이전`: `before=<cursor(firstItem)>` (더 최신 글)
  - `다음`: `after=<cursor(lastItem)>` (더 오래된 글)
  - `최신`: `/posts` (커서 초기화)
- `aria-label="페이지네이션"`은 유지한다.
- `per_page`, `q`는 모든 페이지네이션 링크에 보존한다.
- 헤더의 “1-10 / 총 N개” 형태는 cursor 모드와 맞지 않으므로 아래 중 하나로 변경한다.
  - A(권장): `총 N개의 글`만 표시(필요 시 COUNT 쿼리 유지)
  - B: COUNT 쿼리를 제거하고 `현재 ${posts.length}개 표시`만 표시

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
- 회귀 영향(기존 테스트 갱신 필요)
  - `scripts/test-step-5.mjs` (페이지네이션 테스트 케이스를 cursor 기반으로 갱신)
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

