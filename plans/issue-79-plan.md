# ISSUE #79 feat: /tags Top tags 쇼케이스 + 전체 태그 drawer + 검색

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/79
- Issue 번호: 79
- 기준 브랜치: main
- 작업 브랜치: issue-79-tags-top-showcase-drawer-search
- Worktree 경로: .../.worktrees/issue-79-tags-top-showcase-drawer-search
- 작성일: 2026-02-18

## 배경/문제
태그가 늘어나면서 `/tags` 전체 목록이 과밀해져 한 번에 스캔이 어렵고 원하는 태그를 찾기 힘들다.
현재는 `src/app/tags/page.tsx`에서 카드형 그리드로 전체 태그를 한 번에 노출한다.

## 목표
- [ ] 첫 화면 인지부하를 줄이고(조용한 화면) 태그 탐색/검색을 빠르게 만든다.
- [ ] 태그가 계속 늘어나도 레이아웃이 안정적이며(visual regression 안정), 접근성이 유지된다.

## 범위
### 포함
- 상단 태그 검색 입력 추가
  - URL 상태 반영: `/tags?q=...`
  - `<form method="get">` 기반(최소 JS)으로 구현
- 태그 카운트/노출 기준(기존 동작 유지)
  - 기본: `published`만 집계/노출
  - admin 세션: `draft` 포함 집계/노출
- Top tags 쇼케이스 섹션
  - `count DESC` 기준 상위 N개(기본값: 10)를 큰 카드로 노출
  - 카드 전체 클릭 가능(넓은 hit-area)
  - `#태그명` + `N개` 표기
  - (선택) 태그명 해시 기반 accent 컬러 적용
- 전체 태그 drawer 섹션(기본 접힘)
  - `<details>/<summary>` 기반 구현(JS OFF 동작)
  - summary에 `전체 태그 (총 N개)` + `전체 보기` CTA
  - 접힘 상태: 미리보기 칩 M개(기본값: 10)
  - 펼침 상태: 전체 태그 그리드
- 검색 시 동작(권장)
  - `q`가 있으면 drawer 기본 open + 필터링 결과만 노출
  - `q`가 있으면 Top tags 섹션 숨김(중복/시선 분산 방지)
- UI 디테일
  - 긴 태그명 레이아웃 보호(`min-w-0` + `truncate` 또는 `break-words`)
  - 숫자 정렬감 개선(`tabular-nums`)
  - 키보드 포커스 가시성(`focus-visible:ring-*`)

### 제외
- 태그 목록/검색을 별도 페이지로 분리
- 태그 생성/수정 정책 변경

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

### 세부 작업
- [ ] `src/app/tags/page.tsx`에서 `searchParams.q` 지원(정규화/길이 제한 포함, `q` 최대 100자, `searchParams`는 `Promise`이므로 `await`로 접근)
- [ ] Top tags 데이터/뷰 분리 + 카드형 쇼케이스 레이아웃 추가
- [ ] 전체 태그 drawer(`<details>`) 추가 + 미리보기 chips/전체 목록 렌더링
- [ ] 검색 시 drawer open + 결과 필터링(Top tags 숨김 여부 포함)
- [ ] (선택) 태그 accent 컬러(해시 기반) 적용

## 구현 메모
- SQL 필터는 `LIKE` 기반으로 optional 적용
  - `q`가 없으면 전체
  - `q`가 있으면 `t.name`에 포함되는 태그만
- 정렬은 기본 `count DESC, name ASC` 유지
- Top tags 선정: `count DESC, name ASC` 상위 N개(동일 count tie-break)
- 검색 매칭: `trim` 후 부분일치, SQLite `LIKE` 기본 동작 기준(ASCII는 case-insensitive, Unicode는 대소문자 folding 제한)
- (선택) 태그 accent 컬러: 고정 팔레트 + `tag -> hash -> palette index`로 결정(랜덤 금지)

## 리스크 및 확인 필요 사항
- 태그가 많아질수록 렌더링 비용이 증가하므로 검색/접힘 상태에서 DOM 크기를 제한해야 함(미리보기/접힘 기본값 유지)
- `q` 정규화/길이 제한이 없으면 URL이 과도하게 커지거나(또는 예외 케이스) 성능/로그 품질에 영향
- visual regression 안정화를 위해 애니메이션/랜덤 요소(색상 포함)를 고정해야 함

## 영향 파일(예상)
- `src/app/tags/page.tsx`
- `src/lib/post-list.ts` (태그 검색 필터/limit 등 데이터 조회 변경 시)
- `src/components/*` (필요 시 Top tags, drawer 컴포넌트 분리)
- `tests/ui/tags-index.spec.ts`
- `tests/ui/visual-regression.spec.ts`
- `tests/ui/accessibility.spec.ts`
- (신규) `tests/ui/tags-search.spec.ts` 또는 기존 스펙 확장

## 완료 기준(DoD)
- [ ] `/tags`에 검색 입력이 있고, `q`가 URL에 반영된다.
- [ ] `q`가 없을 때: Top tags 섹션 + drawer(기본 접힘)가 노출된다.
- [ ] `q`가 있을 때: drawer가 기본 open이며, 결과는 `q`로 필터링된다. (Top tags는 숨김)
- [ ] 긴 태그명/큰 카운트에서도 레이아웃이 깨지지 않는다.
- [ ] `npm run test:ui` 통과
- [ ] PR 전 `npm run test:all` 통과

## 검증 계획
- [ ] Playwright visual regression: `/tags` 기본 상태 스냅샷(모바일/태블릿/데스크탑: `360/768/1440`)
- [ ] Playwright 기능: `/tags?q=sa` 검색 시 필터링 + drawer open + Top tags 숨김 동작
- [ ] Playwright a11y: `/tags` serious/critical 위반 0 유지(`tests/ui/accessibility.spec.ts`)
- [ ] 기존 `tests/ui/tags-index.spec.ts`를 새 UI(Top tags + drawer 기본 접힘/검색 시 open)에 맞게 갱신하되, admin/draft 노출 규칙 회귀 테스트는 유지
- [ ] Playwright 기능: drawer 기본 접힘 상태에서 미리보기 칩 M개만 렌더링되고, summary 클릭 시 전체 태그가 노출되는지 확인
- [ ] Playwright a11y: `/tags?q=sa`에서도 serious/critical 위반 0 유지(검색 UI 상태 차이)
- [ ] (선택) Playwright(JS OFF): `javaScriptEnabled: false` 컨텍스트에서 `<details>/<summary>` 토글 및 태그 링크 내비게이션 동작 확인
