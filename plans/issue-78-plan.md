# ISSUE #78 feat: 글 목록 검색 자동완성(타이핑 중 추천/즉시 매칭)

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/78
- Issue 번호: 78
- 기준 브랜치: main
- 작업 브랜치: issue-78-posts-search-autocomplete
- Worktree 경로: .../.worktrees/issue-78-posts-search-autocomplete
- 작성일: 2026-02-18

## 배경/문제
`/posts`의 검색은 현재 submit(Enter/버튼) 기반이라, 타이핑 중에는 일치 결과/추천이 즉시 보이지 않는다. (`src/app/posts/page.tsx`)

검색바 아래에 추천(자동완성) 목록을 표시하거나, 타이핑하면서 즉시 매칭 결과를 힌트로 보여주는 기능을 추가해 검색 UX를 개선한다.

- 관련 이슈: #54 (검색/필터 확장 방향과 겹칠 수 있음)
- 참고: `src/components/SearchBar.tsx`는 현재 코드에서 사용되지 않음(정리/재활용 여부는 본 이슈 범위 밖)

## 목표 (MVP)
- [ ] 검색어 입력 시(예: 2글자 이상) debounce 후 추천 목록을 검색바 아래에 표시
- [ ] 추천 항목은 최대 N개(기본값: 8개)로 제한
- [ ] 마우스 클릭 + 키보드(Up/Down/Enter/Esc)로 조작 가능
- [ ] 빈 값/공백 입력 시 추천 숨김
- [ ] 쿼리 길이 제한 준수(현재 `/posts`의 `MAX_SEARCH_QUERY_LENGTH = 100`)
- [ ] FTS5 문법 오류 가능 입력 처리
  - 자동완성(suggest): 타이핑 UX를 위해 조용히 빈 목록 처리(에러 메시지 미표시)
  - `/posts` 검색 결과: 기존 동작 유지(에러 메시지 "검색어가 올바르지 않습니다")

## 범위 옵션
- 옵션 A: 추천(자동완성)만 제공 (확정)
- 옵션 B: 추천 + "즉시 검색 결과"(타이핑 중 목록도 갱신) (보류: DB/검색 아키텍처 변경 이후 재검토)
  - 네트워크/DB 부하 고려: debounce + 요청 취소(AbortController) 필요

## 결정 사항(확정)
- 범위: 옵션 A(추천만). 옵션 B(즉시 검색 결과)는 DB/검색 아키텍처 변경 이후 재검토
- 추천 항목: 포스트 추천(표시는 제목 중심)
- 추천 선택 시 이동: published → `/posts/[slug]`, draft(admin) → `/admin/write?id=...`
- 권한/노출: `/posts`와 동일(공개=`published`만, `admin_session` 유효 시 `draft+published`)
- 매칭/정렬: title+content 검색 + title 가중치 우선 랭킹(bm25 column weights) + 마지막 토큰만 prefix(`*`) 적용
- FTS5 문법 오류 입력: suggest는 조용히 빈 목록 처리(에러 메시지 미표시), `/posts` 검색 결과는 기존 오류 메시지 유지("검색어가 올바르지 않습니다")

## 범위
### 포함
- API route 추가: `GET /api/posts/suggest?q=...`
  - 입력 검증(빈 값/공백/최대 길이) + debounce 사용을 전제로 빠른 응답
  - DB: `posts_fts MATCH ?` + posts 조인 + LIMIT
  - 마지막 토큰 prefix 매칭(`*`) 적용
- UI: `/posts` 검색 입력을 progressive enhancement 형태로 확장
  - JS ON: client 컴포넌트로 typeahead + dropdown
  - JS OFF: 기존 GET form submit 유지
- 접근성: combobox/listbox 패턴(ARIA) + 포커스/키보드 내비게이션
- 상태 UI: loading/empty/error(정책에 따라 오류 메시지 or 무표시) 포함

### 제외
- 검색 랭킹 고도화(스니펫 하이라이트, 검색 히스토리/인기어 등)
- 복잡한 "즉시 검색 결과" UI(옵션 B는 보류: DB/검색 아키텍처 변경 이후 재검토)
- FTS5 스키마 재설계/대규모 마이그레이션

## 설계안 (초안)
### API: `/api/posts/suggest`
- Request
  - `q`: string (trim 후 길이 체크)
- Query build(FTS5)
  - `q`를 공백 기준으로 토큰화한 뒤, 마지막 토큰에만 `*`를 붙이고 AND 결합한다. (예: `foo bar` → `foo bar*`)
  - FTS5 문법 오류를 줄이기 위해 따옴표/연산자 등은 토큰에서 제거하거나 안전한 토큰만 사용한다(실패 시 silent empty).
- 권한/노출
  - `/posts`와 동일(공개=`published`만, `admin_session` 유효 시 `draft+published`)
- Response (예시)
  - `items: { id, slug, title, status, publishedAt? }[]`
  - `meta: { q, truncated }`
- Error Response
  - 서버 오류 응답은 공통 에러 envelope를 따른다: `{ error: { code, message, details } }`
- 캐시/동적 처리
  - `export const dynamic = "force-dynamic"` 적용(세션/쿠키 기반 권한 반영, 캐시 혼선 방지)
- 정렬
  - 1차: 관련도(bm25, title 가중치 우선, `bm25()`는 값이 작을수록 더 관련도가 높으므로 `ASC`) + 마지막 토큰 prefix 반영
  - 2차: 최신순 tie-break(`published_at/created_at DESC`, `id DESC`)
- 에러 처리
  - FTS5 파서 에러 등은 500 대신 조용히 "빈 목록"으로 폴백(자동완성 UX 우선)

### UI: `/posts` 검색 typeahead
- 입력 2글자 이상 + debounce(예: 200ms) 후 suggest 호출
- IME 대응
  - composition 중에는 요청/드롭다운 갱신을 보류하고, compositionend 이후 debounce를 시작한다.
- 레이스/취소
  - AbortController(또는 requestId)로 이전 요청을 취소하고 최신 응답만 반영한다.
- dropdown 열림/닫힘
  - 열림: 유효한 입력 + 결과(또는 loading)
  - 닫힘: Esc, blur(외부 클릭), 입력 비움/공백
- 키보드
  - Up/Down: active item 이동(순환 여부 결정)
  - Enter: active item 선택(이동 정책 적용)
  - Esc: 닫기 + 입력 유지
- 접근성
  - combobox/listbox roles + `aria-expanded`, `aria-activedescendant` 등 적용
  - 포커스 이동/스크린리더 동작은 Playwright + axe로 회귀 고정

## 구현 단계
1. [ ] 분석
   - `src/app/posts/page.tsx` 및 `/posts` 검색 로직(FTS5) 확인
   - `MAX_SEARCH_QUERY_LENGTH` 정의 위치/재사용 방안 확인
   - (선택) `isFtsQuerySyntaxError` 등 FTS 문법 오류 판별 로직을 `src/lib`로 추출해 API/UI에서 재사용할지 검토(중복 방지)
2. [ ] API 구현
   - `src/app/api/posts/suggest/route.ts` 추가
   - 입력 정규화/길이 제한/권한 정책 반영
   - FTS5 문법 오류 처리(try/catch) 및 응답 형태 확정
   - 관리자 세션 확인 시 `touch: false`로 last_seen_at 갱신을 피한다(타이핑 중 호출 특성상 DB write 방지)
3. [ ] UI 구현
   - `/posts` 검색 입력을 client로 분리(예: `PostsSearchTypeahead` 등) 또는 현재 구조 내 점진적 확장
   - debounce + 요청 취소 + dropdown 렌더 + 상호작용(마우스/키보드)
4. [ ] 테스트
   - Playwright: `/posts`에서 타이핑 -> 추천 표시
   - Playwright: 추천 클릭/Enter -> 기대 URL 이동
   - 접근성: `@axe-core/playwright` 케이스 추가/확장
   - Visual regression: dropdown 열린 상태 스냅샷(필수)
5. [ ] 문서화/정리
   - `docs/codebase.md`에 suggest API/검색 UX 동작(결정 사항) 반영(필요 시)

## 리스크 및 확인 필요 사항
- FTS5 쿼리 구성 방식에 따라 입력(따옴표/연산자 등)이 파서 에러를 유발할 수 있음(500 방지 필요)
- 추천 API가 `/posts` 페이지 조회/검색과 노출 규칙이 어긋나면 혼란/보안 리스크(draft 노출) 발생 가능
- 타이핑마다 호출되는 API 특성상 저사양(1GB RAM) 환경에서 부하가 증가할 수 있음(debounce + LIMIT + 최소 필드)
- 옵션 B(즉시 검색 결과)는 UI/쿼리 비용이 커질 수 있어 단계적 적용이 적합

## 완료 기준(DoD)
- [ ] `/posts` 검색 입력에서 자동완성 dropdown이 표시된다(2글자 이상, debounce 적용).
- [ ] 추천 항목은 최대 8개로 제한된다.
- [ ] 마우스/키보드(Up/Down/Enter/Esc)로 조작 가능하고, blur/외부 클릭으로 닫힌다.
- [ ] public은 published만 추천되고, admin_session 유효 시 draft+published가 추천된다.
- [ ] FTS5 문법 오류 입력 시 suggest는 조용히 빈 목록 처리되고, `/posts` 검색 결과는 기존 오류 메시지를 유지한다.
- [ ] JS OFF에서도 `/posts`의 GET submit 검색이 동작한다.
- [ ] `npm run test:all` 통과.

## 검증 계획
- [ ] `npm run test:all`
- [ ] Playwright(E2E)
  - [ ] public: 입력 길이 1/공백 입력 시 추천 미노출, 길이 2 이상에서 debounce 후 추천 노출
  - [ ] public: 추천 항목 최대 8개 상한 고정
  - [ ] public: 키보드 Up/Down/Enter/Esc 및 외부 클릭으로 열림/닫힘/선택 동작 + 선택 시 `/posts/[slug]`로 이동
  - [ ] public: title에 키워드가 없어도 content 매칭으로 추천이 표시된다
  - [ ] public: 마지막 토큰 prefix(`*`)로 부분 입력에서도 추천이 표시된다(예: kube → kubernetes)
  - [ ] public: FTS5 문법 오류 입력 시 suggest는 조용히 빈 목록(에러 UI 없음)
  - [ ] public: 동일 입력으로 `/posts` submit 결과는 기존 오류 메시지 동작 유지("검색어가 올바르지 않습니다")
  - [ ] 권한: public=published만, admin_session 유효 시 draft+published 추천 + draft 선택 시 `/admin/write?id=...`로 이동
  - [ ] JS OFF: `/posts` GET submit 동작 유지(최소 1 케이스)
- [ ] axe: `/posts`에서 combobox/listbox 접근성 검사 통과(추천 dropdown 열린 상태 포함)
- [ ] 스냅샷: `/posts` 추천 dropdown 열린 상태 스냅샷(최소 뷰포트 `360/768/1440`)
