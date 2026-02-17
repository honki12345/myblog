# ISSUE #49 feat: 글 목록에 썸네일 이미지 노출

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/49
- Issue 번호: 49
- 기준 브랜치: main (origin/main)
- 작업 브랜치: issue-49-feat-post-list-thumbnail
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-49-feat-post-list-thumbnail
- 작성일: 2026-02-17

## 배경/문제
글 본문(마크다운)에 이미지가 포함된 경우, 글 목록 카드(`PostCard`)에서 대표 이미지 1장을 썸네일로 선정해 함께 노출하고 싶다.

대상 화면 예:
- 홈(`/`)
- 글 목록(`/posts`)
- 태그 목록(`/tags/[tag]`)

## 목표
- [ ] 본문 마크다운에서 썸네일 후보를 추출해 대표 이미지 1장을 결정한다.
- [ ] `PostCard` 기반 목록 UI에서 썸네일이 있는 글은 썸네일을 노출한다.
- [ ] 이미지가 없는 글은 기존 카드 레이아웃을 유지한다.
- [ ] Playwright 테스트로 이미지 유/무 케이스 렌더링을 검증한다.

## 범위
### 포함
- 썸네일 선정 규칙(최소 1개 규칙) 확정
- 마크다운에서 이미지 URL 1개 추출
- `PostCard` UI 변경(반응형 포함)
- 성능/캐시 전략 결정 및 구현
- Playwright 테스트 추가

### 제외
- 이미지 자체 리사이징/최적화 파이프라인(별도 이슈로 분리)
- 다중 썸네일/갤러리 UI

## 결정 필요(옵션)
### A. 렌더 시 파싱(빠른 도입)
- 장점: DB 변경/마이그레이션 없이 적용 가능
- 단점: 목록 렌더링마다 본문 파싱 비용 발생(특히 다수 카드)

### B. 저장 시 썸네일 URL 저장(권장 가능)
- 장점: 목록 조회 시 DB 컬럼만으로 썸네일 제공(성능 유리)
- 단점: DB 스키마 변경 및 작성/스크랩 경로 모두 반영 필요

**결정(권장)**: 이번 이슈에서는 옵션 A(렌더 시 파싱)로 구현하고, 옵션 B(DB 저장)는 실제 성능 이슈가 확인되면 별도 이슈로 분리한다.

### 추가 결정
- 썸네일 렌더링: `img` 태그 기반으로 렌더링한다. (`next/image` 미사용)
- 외부 이미지 허용: `https://...` 허용
- 로드 실패 fallback(권장): 썸네일 로드 실패 시 placeholder 이미지로 대체한다.
  - 구현 힌트: 썸네일만 Client Component로 분리해 `onError`에서 placeholder로 전환

## 구현 단계
1. [ ] 현황 파악
- `PostCard` 사용 위치 확인(홈/목록/태그)
- 포스트 모델(조회 DTO)에서 목록에 전달되는 필드 파악(본문 포함 여부)

2. [ ] 썸네일 선정 규칙 확정
- 기본값: 마크다운 이미지 문법 `![alt](url)` 중 첫 번째 "허용 URL" 이미지를 썸네일로 사용 (URL은 `(<...>)` 형태도 허용)
- 허용 URL: 업로드 경로(`/uploads/...`) + 외부 `https://` (`img` 렌더링 기준. `next/image` 설정 불필요)

3. [ ] 썸네일 추출 구현
- 옵션 A(렌더 시 파싱)로 구현
- 추출 실패 시 `null` 처리
- 추출 규칙(권장): 마크다운에서 이미지 후보를 순서대로 탐색하고, URL이 허용 규칙에 맞는 첫 번째 이미지를 채택한다.
  - 허용: `/uploads/...` 또는 `https://...`
  - 제외: `data:` URL, `http://`, 기타 상대 경로/로컬 경로
  - 구현 방식: (권장) 정규식 기반으로 `![...](...)`를 순회하며 첫 번째 "허용 URL"만 추출 (복잡한 파싱은 차후 개선)

4. [ ] `PostCard` UI 적용
- 썸네일이 있는 경우: 고정 비율 썸네일 영역 + 텍스트 영역 레이아웃
- 썸네일이 없는 경우: 기존 레이아웃 유지
- 썸네일 로드 실패 시(권장): placeholder로 대체해 깨진 이미지 아이콘이 보이지 않도록 처리
- 반응형: 최소 모바일(360)에서 깨지지 않도록 구성

5. [ ] 테스트(Playwright)
- 대상 페이지: 홈(`/`), 글 목록(`/posts`), 태그(`/tags/[tag]`)에서 카드 렌더링 확인
- 이미지 있는 글: 카드에 썸네일 렌더링됨을 검증
- 이미지 없는 글: 썸네일 영역이 없고 기존 레이아웃 유지됨을 검증
- (권장) 이미지 로드 실패: 존재하지 않는 `/uploads/...`를 가진 글에서 placeholder로 대체됨을 검증
- 스크린샷 비교: 최소 뷰포트 `360/768/1440` 포함
- 테스트 데이터: Playwright 시드(`seedVisualPosts`)에 "썸네일 있는 글/없는 글"을 포함하고, 썸네일 URL은 실제 로드 가능한 `/uploads/...` 사용
  - 권장: 테스트용 이미지를 `public/uploads/...`에 두고, 마크다운에는 `/uploads/...`로 참조한다. (Playwright standalone 서버에서도 404 없이 로드)
- 검증 방식: `toHaveScreenshot` + 기능 assertion(예: 썸네일 컨테이너에 `data-*` 추가 후 존재/부재 확인) + (권장) axe serious/critical 위반 없음

6. [ ] 문서/정리
- 구현 결정(옵션 A/B)과 이유를 이 문서에 기록

## 구현 기록 (2026-02-17)
- 선택: 옵션 A(렌더 시 파싱)
  - 이유: DB 스키마 변경 없이 빠르게 도입 가능하며, 현재 목록 쿼리에서 본문(`content`)을 이미 조회하고 있음
- 캐시 전략: in-memory LRU(Map 기반, 500개)로 `post:{id}:{updated_at}` 키에 대해 썸네일 URL 추출 결과를 캐시
- 썸네일 UI: `img` 기반(Next/Image 미사용), 로드 실패 시 `/thumbnail-placeholder.svg`로 대체하도록 Client Component(`PostCardThumbnail`)에서 처리

## 리스크 및 확인 필요 사항
- 현재 홈/목록/태그 페이지가 `posts.content`를 조회하고 있어 옵션 A(렌더 시 파싱)는 적용 가능. 다만 향후 목록 쿼리를 최적화하며 `content`를 제외하면 썸네일 추출 방식(옵션 B 등)도 함께 재검토 필요
- 외부 이미지 사용 시 CSP(있다면)/핫링크/프라이버시 및 로드 실패 fallback 영향
- 옵션 B 선택 시: DB 마이그레이션(썸네일 URL 컬럼), 단건/벌크/수정 등 저장 경로별 썸네일 갱신 규칙 통일, 기존 글 썸네일 backfill(배치 or 지연 계산) 전략 필요

## 검증 계획
- [ ] `npm run test:all` (프로젝트 규칙에 따라)
- [ ] Playwright: 이미지 유/무 카드 스크린샷 및 기능 assertion 통과

## PR 리뷰 반영 내역 (2026-02-17)
- 코멘트(Inline, CodeRabbit): `tests/ui/admin-write-redirect.spec.ts`의 `async ({}, testInfo)` 패턴이 Biome `noEmptyPattern` 린트 에러를 유발
  - 변경: `async (_fixtures, testInfo)`로 수정
  - 변경 파일: `tests/ui/admin-write-redirect.spec.ts`
  - 검증: `npm run lint`
- 코멘트(Review, CodeRabbit): 시각 회귀 테스트에 axe-core 접근성(serious/critical) 검증 추가
  - 변경: `tests/ui/visual-regression.spec.ts`에서 스크린샷 직전에 `@axe-core/playwright` 검사 실행
  - 변경 파일: `tests/ui/visual-regression.spec.ts`
  - 검증: `PLAYWRIGHT_PORT=3400 npm run test:ui -- tests/ui/visual-regression.spec.ts`
- 코멘트(Review, CodeRabbit): `tests/ui/admin-write-redirect.spec.ts`의 fetch 기반 테스트를 page 기반 UI 테스트로 전환하고 스크린샷 + axe-core 검증 추가
  - 변경: `page.goto()` 기반으로 리다이렉트 체인(`/write` → `/admin/write` → `/admin/login?next=...`)을 검증하고, `toHaveScreenshot()` + `@axe-core/playwright` 검사 추가
  - 변경 파일: `tests/ui/admin-write-redirect.spec.ts`, `tests/ui/admin-write-redirect.spec.ts-snapshots/*`
  - 검증: `PLAYWRIGHT_PORT=3400 npm run test:ui -- tests/ui/admin-write-redirect.spec.ts`
