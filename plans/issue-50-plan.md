# ISSUE #50 feat: 태그 인덱스(/tags) 페이지 구현 및 네비게이션 수정

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/50
- Issue 번호: 50
- 기준 브랜치: main
- 작업 브랜치: issue-50-feat-tags-index
- Worktree 경로: .../.worktrees/issue-50-feat-tags-index
- 작성일: 2026-02-17

## 배경/문제
현재 헤더 네비게이션의 `태그` 링크가 `/tags/sample`로 하드코딩(placeholder)되어 있어, 클릭 시 항상 `태그: sample` 페이지로 이동한다.

기대 UX는 다음과 같다.
- `/tags`: 공개 글 기준 태그 목록(및 글 개수)을 보여준다.
- 태그 클릭: `/tags/[tag]`로 이동한다. (`src/app/tags/[tag]/page.tsx`는 이미 존재)

추가로 문서/테스트에 `/tags/sample` 점검 경로가 남아 있어(예: `plans/implementation-plan.md`, `plans/step1-plan.md`, `plans/step5-plan.md`, `tests/ui/visual-regression.spec.ts`) 같이 정리할 필요가 있다.

## 목표
- [ ] 헤더 네비게이션의 `태그` 링크를 `/tags`로 변경한다.
- [ ] 태그 인덱스 페이지(`/tags`)를 구현해 태그 목록과 각 태그의 글 개수를 보여준다.
- [ ] 태그 집계는 **공개 글(published)만** 기준으로 한다.
- [ ] Playwright 테스트로 네비게이션/동작을 고정한다.

## 범위
### 포함
- `src/app/layout.tsx`: 태그 링크 `/tags`로 변경
- `src/app/tags/page.tsx`: 태그 인덱스 페이지 신규
- DB 쿼리: `posts` + `post_tags` + `tags` 조인으로 태그 목록/카운트 조회 (published만)
- UI: 빈 상태(태그 0개) 처리
- 정렬: `count DESC`, `name ASC` (초안)
- Playwright 테스트 추가/갱신
- 문서/테스트 정리: 점검 경로에 `/tags`를 추가하고, 태그 상세 확인용 `/tags/sample`은 목적에 맞게 유지/정리 (`plans/implementation-plan.md`, `plans/step1-plan.md`, `plans/step5-plan.md`, `tests/ui/visual-regression.spec.ts`)

### 제외
- 태그 생성/수정/삭제 UI 및 관리자 기능
- 태그별 페이지(`/tags/[tag]`)의 UI/기능 확장(이번 이슈 범위 밖)
- 태그 검색/필터링/페이지네이션

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

### 세부 작업
- [ ] 현재 네비게이션에서 `/tags/sample` 링크 위치 확인 및 `/tags`로 변경
- [ ] 태그 집계 쿼리 설계
  - [ ] published만 포함 (draft 제외)
  - [ ] 태그별 글 개수(count) 계산
  - [ ] 정렬: count DESC, name ASC
  - [ ] SQL 초안
    - ```sql
      SELECT
        t.name AS name,
        COUNT(DISTINCT p.id) AS count
      FROM tags t
      INNER JOIN post_tags pt ON pt.tag_id = t.id
      INNER JOIN posts p ON p.id = pt.post_id
      WHERE p.status = 'published'
      GROUP BY t.id
      ORDER BY count DESC, name ASC;
      ```
- [ ] `/tags` 페이지 UI 구현
  - [ ] 태그 목록 렌더링 (태그명 + 카운트)
  - [ ] 태그 클릭 시 `/tags/[tag]`로 이동
  - [ ] 빈 상태 안내 문구
- [ ] Playwright 테스트
  - [ ] 네비게이션 `태그` 클릭 시 `/tags`로 이동
  - [ ] `/tags`에서 태그 클릭 시 `/tags/[tag]`로 이동
- [ ] 문서/테스트 업데이트
  - [ ] 문서 점검 경로에 `/tags` 추가 (`plans/implementation-plan.md`, `plans/step1-plan.md`, `plans/step5-plan.md`)
  - [ ] Playwright 시각 회귀에 `/tags` 추가 (기존 `/tags/sample`은 태그 상세 커버리지로 유지) (`tests/ui/visual-regression.spec.ts`)

## 리스크 및 확인 필요 사항
- published 필터 누락 시 draft가 집계/노출될 수 있으므로 쿼리/테스트로 고정 필요
- 태그 라우트 파라미터 인코딩(공백/특수문자) 처리: 링크 생성 시 encode 적용 여부 확인
- 태그 0개(또는 공개 글에 연결된 태그 0개) 케이스에서 UX가 어색해질 수 있음
- `/tags` 인덱스 페이지 캐시/갱신 전략: `export const dynamic = "force-dynamic"` 적용 (항상 최신 태그 집계 노출)
- `/tags` 노출 범위: 공개 글이 1개 이상 연결된 태그만 노출 (`count >= 1`)

## 영향 파일(예상)
- `src/app/layout.tsx`
- `src/app/tags/page.tsx` (신규)
- `src/lib/db/*` (태그 집계 쿼리 추가 위치에 따라)
- `tests/ui/*` (스펙 추가/갱신)
- `plans/implementation-plan.md`
- `plans/step1-plan.md`
- `plans/step5-plan.md`

## 완료 기준(DoD)
- [ ] 네비게이션 `태그` 링크가 `/tags`로 연결된다.
- [ ] `/tags`에서 태그 목록과 글 개수가 노출된다. (published만)
- [ ] `/tags`에서 태그 클릭 시 `/tags/[tag]`로 이동한다.
- [ ] 공개 글 기준 태그 0개일 때 빈 상태 안내 문구가 노출된다.
- [ ] `npm run test:ui` 통과
- [ ] PR 전 `npm run test:all` 통과

## 검증 계획
- [ ] Playwright 기반 시나리오 검증
  - [ ] 최소 뷰포트: `360/768/1440`
  - [ ] 네비게이션 `태그` 클릭 → `/tags`
  - [ ] `/tags`에서 태그 클릭 → `/tags/[tag]`
  - [ ] (public) `/tags`는 draft-only 태그가 노출되지 않는다 (published-only 집계)
  - [ ] `/tags` 빈 상태 안내 문구가 노출된다 (공개 태그 0개)
  - [ ] 시각 회귀: `/tags` 스냅샷 추가 (`tests/ui/visual-regression.spec.ts`)
  - [ ] 접근성: `/tags`, `/tags/[tag]` axe 검사 대상 포함 (`tests/ui/accessibility.spec.ts`)
- [ ] 통과 기준: `npm run test:ui` 및 `npm run test:all` 통과
