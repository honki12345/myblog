# ISSUE #54 feat: 홈(/)과 /posts 역할 분리(태그 허브 + 검색/필터)

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/54
- Issue 번호: 54
- 기준 브랜치: main
- 작업 브랜치: issue-54-home-posts-role-split
- Worktree 경로: .../.worktrees/issue-54-home-posts-role-split
- 작성일: 2026-02-17

## 배경/문제
현재 홈(`/`)과 `/posts`가 실질적으로 동일한 목록 기준(상태/정렬/태그 조인)을 사용하고, UI만 "홈=최신 10개", "/posts=페이지네이션"으로 갈라져 있다.
이 상태로는 역할이 겹치고, 구현이 페이지별로 복붙되어(`/`, `/posts`, `/tags/[tag]`, 메타데이터 등) 앞으로 정책이 쉽게 어긋날 수 있다.

## 목표
- [ ] 홈(`/`)을 탐색 시작점으로 만든다: 태그 허브 + (직접 작성 최신 5) + (AI 수집 최신 5) + CTA.
- [ ] `/posts`를 아카이브로 만든다: 타입 탭(type) + 검색(q, FTS5) + 태그(tag) + 페이지네이션.
- [ ] 공통 노출 규칙 유지: 비로그인=published만, 관리자=draft+published.
- [ ] 목록/정렬/태그/발췌(excerpt)/필터 로직을 공통 모듈로 추출해 중복을 제거한다.
- [ ] Playwright 회귀 테스트로 홈/아카이브/관리자 노출 규칙을 고정한다.

## 요구사항 정리
### 공통 노출 규칙
- 비로그인: `published`만
- 관리자: `draft` + `published`
- 태그 인덱스(`/tags`)의 태그 집계/노출도 동일 규칙 적용(비로그인=published 기준, 관리자=draft+published 기준)

### 1) 홈(/)
- 태그 섹션(허브)
  - 최근 활성 태그 10개(기본값) + 각 태그 글 수 표시
  - 정렬: 태그별 최신 글 날짜(`MAX(COALESCE(p.published_at, p.created_at))`) desc
  - 링크: `/tags`, `/tags/[tag]`
- 최신 직접 작성 5개
  - 기준: `origin = 'original'`
- 최신 AI 수집 5개(컴팩트 리스트)
  - 기준: `origin = 'ai'`
  - 가능하면 출처 도메인 표시
- CTA
  - `/posts?type=original`
  - `/posts?type=ai`
  - `/posts`

### 2) /posts (아카이브)
- 타입 탭/필터: `type=all|original|ai` (기본 `all`)
- 검색(FTS5): `q=`로 제목/본문 검색, 다른 필터와 조합 가능
- 태그 필터: `tag=` 지원, 검색/타입/상태와 조합 가능
- 정렬
  - `q`가 있을 때: 관련도 우선(`bm25(posts_fts) ASC`) + 최신순 tie-break(`published_at/created_at DESC`, `id DESC`)
  - `q`가 없을 때: 최신순(`published_at/created_at DESC`, `id DESC`)
- 페이지네이션 유지: `page`, `per_page`

## 범위
### 포함
- `posts.origin`(original|ai) 컬럼 추가 + backfill 마이그레이션 + `origin` 불변(UPDATE 차단) 트리거
- 공통 리스트 조회 로직 추출 (예: `src/lib/post-list.ts`)
  - status(권한), type(original/ai), tag, q(FTS), 정렬, LIMIT/OFFSET
  - COUNT 쿼리도 동일 조건으로 제공(페이지네이션 정합성)
  - `buildStatusFilter` 등 SQL 필터(clause/params) 헬퍼 공통화
- `stripMarkdown`/`createExcerpt` 공통화 (예: `src/lib/excerpt.ts`)
- 홈(`/`) UI 개편(태그 허브 + 섹션 2개 + CTA)
- `/posts` UI에 type/q/tag 필터 추가(쿼리스트링 기반 상태 유지)
- `posts_fts` 기반 검색 쿼리 구현(파라미터 바인딩)
- `/tags`, `/tags/[tag]`의 노출 규칙/공통 유틸 적용(중복 제거)
- Playwright 회귀 테스트 추가/보강
- (필요 시) `docs/codebase.md`에 `/posts` 쿼리 파라미터 문서화

### 제외
- `posts.origin` 추가를 제외한 새로운 DB 스키마/대규모 마이그레이션(FTS5 재설계 등)
- 관리자 전용 별도 아카이브 UI 신설
- 검색 랭킹/스니펫 하이라이트 등 고급 검색 UX(우선은 필터 정합성/기능 고정)

## 구현 단계
1. [ ] 분석 및 설계
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

### 세부 작업
- [ ] (DB) `posts.origin` 추가 + backfill + 불변 트리거
  - [ ] `origin` 값: `original|ai` (NOT NULL + CHECK)
  - [ ] 마이그레이션 방식: `src/lib/db.ts`의 `schema_versions` 기반 버전 추가(현재 3 → 4)
  - [ ] 컬럼 추가 SQL: `ALTER TABLE posts ADD COLUMN origin TEXT NOT NULL DEFAULT 'original' CHECK (origin IN ('original','ai'))`
  - [ ] backfill SQL(확정): `UPDATE posts SET origin='ai' WHERE source_url IS NOT NULL OR EXISTS (SELECT 1 FROM sources s WHERE s.post_id = posts.id)`
  - [ ] backfill 완료 기준: `origin`은 NULL이 없어야 하고(스키마로 보장), `SELECT origin, COUNT(*) FROM posts GROUP BY origin`로 분포를 샘플 확인한다
  - [ ] 인덱스(필요 시): `CREATE INDEX IF NOT EXISTS idx_posts_origin ON posts(origin)`
  - [ ] `origin` UPDATE 차단 트리거(불변 보장): `BEFORE UPDATE OF origin ON posts ... RAISE(ABORT, 'origin is immutable')`
  - [ ] 새 DB에서도 schema version 4 마이그레이션이 반드시 적용되어 `origin`이 최종적으로 존재해야 함(마이그레이션 only 전략)
- [ ] (리팩토링) `stripMarkdown`/`createExcerpt`를 `src/lib`로 이동하고 `/`, `/posts`, `/tags/[tag]`, `/posts/[slug]`에서 재사용
- [ ] (리팩토링) 리스트 조회 공통 모듈 생성
  - [ ] 입력: `statuses`, `type`, `tag`, `q`, `limit`, `offset`
  - [ ] 출력: 카드 렌더에 필요한 필드 + tags 목록 + (선택) `source_url`/도메인
  - [ ] COUNT 쿼리: 동일 조건으로 `totalCount`
- [ ] (홈) 태그 허브 쿼리 구현
  - [ ] status(권한) 반영
  - [ ] 최근 활성 기준 정렬 + 글 수
  - [ ] N(기본값)=10으로 확정
- [ ] (홈) 최신 직접 작성/AI 수집 2개 섹션 구현
  - [ ] original: `origin = 'original'` 최신 5
  - [ ] ai: `origin = 'ai'` 최신 5 + 출처 도메인(가능 시)
- [ ] (/posts) 쿼리 파라미터 파싱/정규화
  - [ ] `type` 기본값 all, 허용값 외 fallback
  - [ ] `q` trim + 빈 문자열 처리
  - [ ] `q` 정규화 방식 확정(예: 토큰화 후 AND 결합) + FTS 문법 에러 시 500 방지(빈 결과/오류 메시지 처리)
  - [ ] `tag` decode + 빈 문자열 처리
  - [ ] 페이지네이션 링크가 `type/q/tag/per_page`를 보존
- [ ] (/posts) FTS5 검색 구현
  - [ ] `posts_fts MATCH ?` 기반으로 rowid 조인
  - [ ] status/type/tag 필터와 조합
  - [ ] COUNT/LIST 쿼리 결과가 일치하도록 조건/조인 구조 정리
- [ ] (/posts) type=original|ai 필터를 `posts.origin` 기반으로 구현하고, 생성 경로별로 `origin`이 고정되도록 보장
- [ ] (/tags) `/tags`(인덱스) + `/tags/[tag]`(상세) 모두 공통 노출 규칙 적용 + 공통 모듈/유틸로 중복 제거
- [ ] (테스트) Playwright
  - [ ] public: `/posts`에서 `type/q/tag` 조합이 정상 동작(결과/페이지네이션)
  - [ ] public: `/posts` 페이지네이션 링크가 `type/q/tag/per_page`를 보존한다 (+ `type` invalid fallback)
  - [ ] public: `/posts?type=original|ai`가 `origin` 기준으로 정확히 필터링된다
  - [ ] public: `q`에 특수문자/따옴표가 포함돼도 500이 나지 않는다(빈 결과/오류 메시지 처리)
  - [ ] home: 태그 섹션 + original/ai 섹션 렌더(스냅샷)
  - [ ] admin: draft 노출 규칙 회귀 방지(`/`, `/posts`, `/tags`, `/tags/[tag]`)
  - [ ] admin: `/tags` 인덱스에서 draft-only 태그가 노출/집계된다
  - [ ] 스크린샷 비교 최소 뷰포트 `360/768/1440` 포함
  - [ ] (메모) UI 변경으로 기존 visual regression 스냅샷(home/posts 등) 갱신이 필요할 수 있음

## 리스크 및 확인 필요 사항
- FTS5 조인 + 태그 조인 + GROUP BY 조합에서 COUNT/페이지네이션 불일치가 생기기 쉬움(동일 조건/동일 조인 구조 유지 필요)
- 검색어/태그는 사용자 입력이므로 반드시 파라미터 바인딩으로 SQL 인젝션을 방지해야 함(문자열 SQL 조립 금지)
- `q`는 FTS5 문법 파서 에러를 유발할 수 있으므로, `q` 정규화/토큰화 또는 에러 핸들링으로 500을 방지해야 함(빈 결과/오류 메시지 등으로 처리)
- `posts.origin` 마이그레이션/backfill 시 기존 데이터 분류 규칙이 잘못되면 홈/아카이브 type 필터 결과가 어긋날 수 있음(백필 규칙 고정 + 테스트로 고정)
- 관리자/비로그인 분기로 인해 페이지가 동적 렌더링이 필요할 수 있음(캐시/ISR 오동작 시 draft 노출 리스크)
- 저사양(1GB RAM) 환경에서 쿼리/페이지 렌더 비용이 커질 수 있음(불필요한 데이터 선택/조인 최소화)

## 영향 파일(예상)
- `src/app/page.tsx`
- `src/app/posts/page.tsx`
- `src/app/tags/page.tsx`
- `src/app/tags/[tag]/page.tsx`
- `src/app/posts/[slug]/page.tsx` (excerpt 유틸 재사용)
- `src/app/api/posts/route.ts`
- `src/app/api/posts/bulk/route.ts`
- `src/app/api/admin/posts/route.ts`
- `src/lib/db.ts` (필요 시 쿼리 헬퍼 추가)
- `src/lib/post-list.ts` (신규)
- `src/lib/excerpt.ts` (신규)
- `docs/codebase.md`
- `tests/ui/*.spec.ts`

## 완료 기준(DoD)
- [ ] 홈(`/`)에 태그 허브 + 최신 직접 작성 5 + 최신 AI 수집 5 + CTA가 표시된다.
- [ ] `/posts`가 `type/q/tag/page/per_page`를 지원하고, 조합해도 정상 동작한다.
- [ ] 비로그인 사용자는 어디에서도 draft를 볼 수 없다.
- [ ] 관리자는 `/`, `/posts`, `/tags` 계열에서 draft+published를 볼 수 있다.
- [ ] `npm run test:all`이 통과한다.

## 검증 계획
- [ ] `npm run test:all`
- [ ] Playwright: public 시나리오(type/q/tag + 페이지네이션 보존), home 스냅샷, admin draft 노출(/tags 인덱스 포함) 회귀
- [ ] DB 마이그레이션 검증: `origin` 컬럼 존재 + backfill 결과 + `origin` 불변 트리거 동작을 자동화로 확인
