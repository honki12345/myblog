# ISSUE #102 구현 변경 계획: 위키 포스트 메타 비노출

## 메타 정보
- 관련 Issue URL: https://github.com/honki12345/myblog/issues/102
- 관련 PR URL: https://github.com/honki12345/myblog/pull/105
- 기준 브랜치: main
- 작업 브랜치: issue-102-comments-tag-wiki-view
- 작성일: 2026-02-21
- 문서 성격: 기존 `plans/issue-102-plan.md`의 후속 구현 변경 계획

## 변경 배경
- 현재 위키(`/wiki/[...path]`)는 댓글 외에 포스트 제목/원문 링크/포스트 링크를 함께 노출한다.
- 최신 요구사항은 위키에서 포스트 제목/링크를 노출하지 않고, 댓글 자체를 중심으로 탐색하도록 제한하는 것이다.
- 따라서 단순 필터(`origin/status`) 보강보다 공개 위키 경로에서 포스트 메타 조인/응답/렌더링을 제거하는 방향이 필요하다.

## 목표
- [ ] 공개 위키 API 응답에서 포스트 메타(`postSlug`, `postTitle`, `sourceUrl`, `postOrigin`, `postPublishedAt`, `postId`)를 제거한다.
- [ ] 공개 위키 UI에서 포스트 제목/포스트 이동 링크/원문 링크를 제거한다.
- [ ] 위키 관련 테스트(step11 + Playwright + 스냅샷)와 문서를 변경된 계약으로 동기화한다.

## 범위
### 포함
- `src/lib/wiki.ts`의 위키 조회 타입/쿼리/매핑 구조 변경
- `src/app/api/wiki/[...path]/route.ts` 응답 계약 축소
- `src/app/wiki/[...path]/page.tsx` 댓글 카드 UI 단순화(댓글/태그/시간 중심)
- `scripts/test-step-11.mjs`, `tests/ui/wiki-view.spec.ts`, 스냅샷 갱신
- `docs/codebase.md`, `plans/use-cases.md`, `plans/issue-102-plan.md` 문구 동기화

### 제외
- 관리자 댓글 CRUD 권한/동작 변경
- 태그 path 규칙/검증 정책 변경
- `/posts/[slug]` 본문 페이지 기능 변경

## 구현 단계
1. [ ] 위키 공개 응답 계약 축소(포스트 메타 제거)
2. [ ] 위키 UI 렌더링 단순화(링크/제목 제거)
3. [ ] 테스트 및 스냅샷 갱신
4. [ ] 문서/유스케이스 동기화

## 구현 상세 (파일 단위)
- 데이터/쿼리
  - [ ] `src/lib/wiki.ts`
    - [ ] `WikiCommentItem`에서 포스트 메타 필드 제거
    - [ ] `WikiCommentRow`에서 포스트 조인 컬럼 제거
    - [ ] `SOURCE_URL_JOIN_SQL` 제거
    - [ ] `getWikiPathOverview` 쿼리에서 `posts`/`sources` 조인 제거
- API
  - [ ] `src/app/api/wiki/[...path]/route.ts`
    - [ ] `comments` 응답 필드를 축소된 계약으로 반환
  - [ ] `src/app/api/wiki/route.ts`
    - [ ] 루트 요약/카테고리 응답이 경로 API 계약 축소와 독립적으로 유지되는지 회귀 확인
- UI
  - [ ] `src/app/wiki/[...path]/page.tsx`
    - [ ] 댓글 카드의 `블로그 글 보기`, `원문 링크`, 포스트 제목 텍스트 제거
  - [ ] `src/app/wiki/page.tsx`
    - [ ] 루트 위키 화면의 노출 정책이 경로 위키 화면과 일관되는지 확인
- 테스트
  - [ ] `scripts/test-step-11.mjs`
    - [ ] 위키 응답에서 제거 대상 필드 미노출 assertion 추가
    - [ ] 댓글 payload 허용 필드(`commentId`, `content`, `tagPath`, `createdAt`, `updatedAt`) 고정 assertion 추가
  - [ ] `tests/ui/wiki-view.spec.ts`
    - [ ] 포스트 링크/원문 링크 assertion 제거
    - [ ] 댓글/태그/브레드크럼 중심 assertion 유지
  - [ ] `tests/ui/accessibility.spec.ts`
    - [ ] `/wiki`, `/wiki/[...path]` 접근성 회귀 확인
  - [ ] `tests/ui/wiki-view.spec.ts-snapshots/*` 갱신
- 문서
  - [ ] `plans/issue-102-plan.md`에서 "원문 AI 글 링크" 표현 제거
  - [ ] `plans/use-cases.md`의 `UC-WIKI-002` 기본흐름/수용기준을 댓글 중심 계약으로 갱신하고 Traceability Matrix를 동기화
  - [ ] `docs/codebase.md`의 Architecture/API/Task Context Map에서 포스트 메타·원문 링크 노출 문구를 제거하고 테스트 매핑을 동기화

## 리스크 및 확인 필요 사항
- 외부 소비자는 현재 없지만, 공개 API 응답 스키마 축소로 내부/향후 연동 코드 호환성 이슈가 발생할 수 있다.
- 스냅샷 대량 변경으로 실제 회귀와 의도된 변경이 섞여 보일 수 있다.
- step11 시나리오가 포스트 메타 의존 assertion을 포함하면 실패 가능성이 높다.

## 결정 필요 항목 (Decision Log)

| 항목 | 현재 상태 | 결정 주체 | 결정 기한 | 적용 범위 | 미결 시 기본안 | 비고 |
| --- | --- | --- | --- | --- | --- | --- |
| 공개 위키 댓글 payload 필드 | 확정 | 구현 담당자(PR 작성자) | 구현 1단계 시작 전 | `src/lib/wiki.ts`, `/api/wiki/[...path]` | `commentId`, `content`, `tagPath`, `createdAt`, `updatedAt` 유지 | step11에서 허용 필드 고정 assertion으로 회귀 차단 |
| 위키 UI에서 포스트 메타 노출 | 확정 | - | - | `/wiki/[...path]` | - | 포스트 제목/링크/원문 링크 비노출 |
| 계약 변경 공지 범위 | 확정 | 구현 담당자(PR 작성자) | PR 생성 전 | PR 본문, `docs/codebase.md`, `plans/use-cases.md` | 위 3개 위치에 축소된 응답 스키마를 명시 | 외부 소비자 없음(내부 공지 범위로 충분) |

## 검증 계획
- [ ] `npm run test:step11`
- [ ] `npm run test:ui -- tests/ui/wiki-view.spec.ts` (mobile-360/tablet-768/desktop-1440 포함)
- [ ] `npm run test:ui:update -- tests/ui/wiki-view.spec.ts` (의도된 UI 변경 반영 후 스냅샷 갱신)
- [ ] `npm run test:all`
- [ ] Playwright 기능 assertion + 스냅샷 diff + a11y 결과로 `/wiki`, `/wiki/[...path]` 비노출 계약 확인

## 완료 기준 (Definition of Done)
- [ ] 공개 위키 API 응답에 포스트 메타 필드가 존재하지 않는다.
- [ ] 공개 위키 UI에 포스트 제목/포스트 링크/원문 링크가 노출되지 않는다.
- [ ] step11에서 축소된 댓글 payload 허용 필드 집합 검증이 통과한다.
- [ ] step11 + wiki UI 테스트 + 전체 회귀가 통과한다.
- [ ] `plans/issue-102-plan.md`, `plans/use-cases.md`, `docs/codebase.md`가 변경된 계약으로 동기화된다.
