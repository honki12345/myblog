# ISSUE #112 feat: 위키 페이지 내용/태그 검색 기능 추가

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/112
- Issue 번호: 112
- 기준 브랜치: main
- 작업 브랜치: feat/issue-112-wiki-content-tag-search
- 작성일: 2026-02-24

## 배경/문제
- 위키 페이지(`/wiki`, `/wiki/[...path]`)에서 원하는 문서를 찾기 위해 트리 탐색에만 의존하고 있어 탐색 비용이 크다.
- 이슈 요구사항은 내용 키워드 검색과 태그(경로) 검색을 함께 제공하고, 결과 상태(정렬/빈 결과/로딩/에러) UX까지 정의하는 것이다.
- 공개 위키 노출 규칙(`hidden/deleted` 비노출)을 유지하면서 검색 결과 정확도를 보장해야 한다.

## 목표
- [ ] 위키 탐색 UI에 검색 입력과 초기화 인터랙션을 추가한다.
- [ ] 내용 키워드 검색과 태그(경로) 검색을 단독/조합 형태로 제공한다.
- [ ] 검색 결과 상태 UX와 API 계약을 정리하고 테스트로 회귀를 방지한다.

## 범위
### 포함
- 위키 화면 및 관련 API(`src/app/wiki/**`, `src/app/api/wiki/**`) 검색 기능 구현
- 위키 탐색/집계 로직 및 클라이언트 셸(`src/components/wiki/WikiExplorerClient.tsx`, `src/lib/wiki.ts`, `src/lib/comment-tags.ts`) 검색 연동
- 검색 필터/정렬/상태 표시(로딩, 빈 결과, 에러) 반영
- 공개 노출 규칙 유지 검증 및 Playwright 테스트 보강
- `plans/use-cases.md` Traceability Matrix 업데이트

### 제외
- 관리자 전용 포스트/메모/할일/일정/방명록 기능 변경
- 검색과 무관한 위키 IA(정보구조) 대규모 개편
- 배포/인프라 설정 변경

## 사전 점검(필수)
- [ ] `docs/codebase.md`의 `Sync Anchor (main)` 및 `Task Context Map` 확인
- [ ] 댓글/위키 변경 기준 경로 확인 (`src/app/wiki/**`, `src/app/api/wiki/**`, `src/app/api/admin/posts/[id]/comments/**`, `src/lib/comment-tags.ts`, `src/lib/wiki.ts`, `src/components/wiki/WikiExplorerClient.tsx`)
- [ ] `plans/use-cases.md`의 WIKI 유스케이스(UC-WIKI-001, UC-WIKI-002) 및 Traceability Matrix 기준 확인

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

### 단계별 산출물
1. 분석 및 재현
   - 검색 요구사항 정리본(범위/정렬/호환성/불변식)
   - 기존 `/api/wiki*` 응답 계약 비교표(변경/유지 항목)
2. 구현
   - API/위키 UI 변경 코드 + 검색 파라미터 계약 반영
   - 필요 시 DB 인덱스/마이그레이션 반영
3. 테스트
   - `scripts/test-step-11.mjs`, Playwright 기능/a11y/시각 회귀 결과
   - `npm run test:all` 실행 결과
4. 문서화/정리
   - `plans/use-cases.md` 유스케이스/Traceability Matrix 업데이트
   - 이슈 계획 문서/PR 본문에 계약 및 테스트 결과 정리

## 완료 기준(Definition of Done)
- [ ] 검색 API 계약(`q`, `tagPath`, `limit`, `sort`, 오류 응답, 호환성 기준)이 문서와 코드에 일치한다.
- [ ] 위키 UI에서 검색 입력/초기화/상태 UX(로딩·빈 결과·에러·재시도)가 동작한다.
- [ ] 공개 노출 불변식(hidden/deleted 비노출, 비관리자 `블로그 글 보기` 비노출)이 유지된다.
- [ ] `scripts/test-step-11.mjs`, `tests/ui/wiki-view.spec.ts`, `tests/ui/accessibility.spec.ts`, `npm run test:all`이 통과한다.
- [ ] `plans/use-cases.md` 유스케이스 명세/Traceability Matrix가 변경사항과 동기화된다.

## API 계약(초안)
- `/api/wiki`, `/api/wiki/[...path]` 모두 검색 파라미터(`q`, `tagPath`, `limit`, `sort`)를 지원한다.
- 검색 파라미터 미지정 시 기존 응답 스키마/동작을 유지한다. (호환성 기본값)
- `q` 검색 범위는 `post_comments.content` + `posts.title`로 고정한다.
- 키워드+태그 조합 시 기본 정렬 우선순위는 `관련도 -> updated_at DESC -> id DESC`로 고정한다.
- 검색 파라미터의 허용값/기본값/오류 응답(`INVALID_INPUT`)을 API 문서와 테스트에 동일하게 반영한다.
- `/api/wiki/[...path]`에서는 `tagPath`를 허용하지 않고, 동시 입력 시 `400 INVALID_INPUT`을 반환한다.

## 구현 영향 파일(예상)
- `src/app/wiki/page.tsx`
- `src/app/wiki/[...path]/page.tsx`
- `src/components/wiki/WikiExplorerClient.tsx`
- `src/app/api/wiki/route.ts`
- `src/app/api/wiki/[...path]/route.ts`
- `src/lib/wiki.ts`
- (필요 시) `src/lib/db.ts` (검색 성능 인덱스/마이그레이션)

## 리스크 및 확인 필요 사항
- 내용 키워드 검색 범위(댓글 본문/문서 본문)와 가중치 기준이 모호하면 UX 일관성이 깨질 수 있다.
- 태그 검색과 키워드 검색 조합 시 결과 정렬 우선순위를 명확히 정해야 한다.
- 검색 API 확장 시 기존 `/api/wiki` 소비자와의 호환성을 확인해야 한다.
- 내용 검색 방식(`LIKE` 또는 인덱스/FTS) 선택이 늦어지면 성능/일정 리스크가 커진다.

### 리스크 대응 트리거
- 검색 파라미터 미지정 요청에서 응답 스키마/의미 차이가 발생하면 호환성 회귀로 간주하고 병합 전 수정한다.
- 개인 블로그 운영 기준에서 체감 지연 또는 실제 이슈가 확인되면 `LIKE` 기반 검색에서 인덱스/FTS 적용을 검토한다.

## 성능/호환성 의사결정 게이트
- [ ] 내용 검색 초기 구현은 단순 쿼리(`LIKE`)를 우선 적용하고, 운영 체감 기준으로 인덱스/FTS 필요성을 추후 판단한다.
- [ ] 인덱스/스키마 변경이 필요해지는 시점에 `src/lib/db.ts` 마이그레이션 및 회귀 영향 범위를 정의한다.
- [ ] 호환성 기준: 검색 파라미터 미지정 요청은 기존 `/api/wiki*` 응답 구조와 의미를 유지한다.

## 검증 계획
- [ ] 관련 단위/통합 테스트 보강 및 통과
- [ ] `scripts/test-step-11.mjs` 실행 및 통과
- [ ] Playwright 기능 테스트(`tests/ui/wiki-view.spec.ts`) 갱신 및 통과
- [ ] Playwright 접근성 테스트(`tests/ui/accessibility.spec.ts`) 갱신 및 통과
- [ ] Playwright 시각 회귀 테스트(`360/768/1440`) 갱신 및 통과
- [ ] `@axe-core/playwright` 접근성 검사 포함
- [ ] 비관리자 세션에서 댓글 영역 `블로그 글 보기` 링크 DOM 비노출 검증
- [ ] `/api/wiki/[...path]?tagPath=...` 동시 입력 시 `400 INVALID_INPUT` 검증
- [ ] `npm run test:all` 전체 회귀 통과

### 커버리지 매핑(핵심 시나리오)
1. 내용 키워드 검색 단독
   - 대상: `/api/wiki*` 검색 파라미터 + 위키 탐색 UI 결과 목록
   - 검증: 키워드 일치 결과 노출/정렬, 0건 시 빈 결과 UX
2. 태그(경로) 검색 단독
   - 대상: 경로 필터 적용 결과 + 브레드크럼/트리 동기화
   - 검증: 경로 필터 정확도, 기존 경로 탐색 동작 회귀 없음
3. 키워드 + 태그 조합 검색
   - 대상: 조합 필터와 정렬 우선순위
   - 검증: 관련도 우선 -> 최신순 -> id(또는 확정 규칙) 일치
4. 상태 UX
   - 대상: 로딩/빈 결과/에러/재시도
   - 검증: 상태별 메시지와 재시도 인터랙션 일치
5. 공개 노출 규칙
   - 대상: hidden/deleted 비노출, 비관리자 `블로그 글 보기` 링크 DOM 비노출
   - 검증: 기존 공개 가시성 불변식 유지

### 테스트 우선순위
1. 실서비스 유사 통합 검증: `scripts/test-step-11.mjs` (실DB/실API)
2. E2E 기능 검증: `tests/ui/wiki-view.spec.ts` (`360/768/1440`)
3. 품질 보강: `tests/ui/accessibility.spec.ts` + 시각 회귀 스냅샷

### 통과 기준(명시)
- 검색 파라미터 미지정 시 기존 `/api/wiki*` 응답 스키마/동작과 호환된다.
- 검색/조합 검색 결과의 정렬 우선순위가 문서화된 규칙과 일치한다.
- 결과 0건/에러 시 UX 문구와 재시도 동작이 일관되게 동작한다.

## PR 리뷰 반영 내역 (2026-02-24)

### PR #122 코멘트 반영
- 코멘트 요약: `/api/wiki`에서 `limit` 단독 요청이 overview가 아닌 검색 응답으로 전환되는 호환성 문제
  - 변경 파일: `src/app/api/wiki/route.ts`, `scripts/test-step-11.mjs`
  - 반영 내용: `hasSearchParams`에서 `rawLimit`을 제외하고, 검색 모드가 아닐 때 `limit` 파싱을 생략해 기존 overview 응답 형태를 유지
  - 검증: `scripts/test-step-11.mjs`에 `GET /api/wiki?limit=50` 회귀 테스트 추가, `npm run test:all` 통과

- 코멘트 요약: 위키 검색 동시 요청 시 늦게 도착한 이전 응답이 최신 검색 결과를 덮어쓰는 경쟁 상태
  - 변경 파일: `src/components/wiki/WikiExplorerClient.tsx`, `tests/ui/wiki-view.spec.ts`
  - 반영 내용: 검색 요청마다 `AbortController`를 부여하고 이전 요청을 취소하며, stale 응답은 상태 업데이트에서 제외
  - 검증: `tests/ui/wiki-view.spec.ts`에 `slow-keyword -> fast-keyword` 경쟁 시나리오 추가, `npm run test:all` 통과

- 코멘트 요약: 검색 입력 미충족 에러에서 `다시 시도` 버튼이 동작하지 않는 UX 문제
  - 변경 파일: `src/components/wiki/WikiExplorerClient.tsx`, `tests/ui/wiki-view.spec.ts`
  - 반영 내용: 입력 검증 오류에서는 재시도 대상 요청을 비우고 버튼을 숨기도록 분기 추가
  - 검증: `tests/ui/wiki-view.spec.ts`에 빈 입력 에러 시 재시도 버튼 비노출 검증 추가, `npm run test:all` 통과

- 코멘트 요약: `/api/wiki`, `/api/wiki/[...path]`의 `catch` 에러 메시지가 검색/overview를 구분하지 않아 진단 정보가 부족함
  - 변경 파일: `src/app/api/wiki/route.ts`, `src/app/api/wiki/[...path]/route.ts`
  - 반영 내용: 검색 모드와 overview 모드에 따라 서로 다른 `INTERNAL_ERROR` 메시지 반환
  - 검증: `npm run test:all` 통과

- 코멘트 요약: 계획 문서에 로컬 절대 경로(`Worktree 경로`)가 포함되어 정보 노출 위험
  - 변경 파일: `plans/issue-112-plan.md`
  - 반영 내용: 개인 환경 절대 경로 항목 삭제
  - 검증: 문서 diff 확인
