# ISSUE #110 feat: 홈을 위키로 전환하고 위키 탐색 UX 개선

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/110
- Issue 번호: 110
- 기준 브랜치: main
- 작업 브랜치: issue-110-home-wiki-ux
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-110-home-wiki-ux
- 작성일: 2026-02-22

## 배경/문제
- 루트 경로(`/`)가 관리자 로그인 중심으로 동작해 공개 진입점 역할이 약하다.
- 위키 인덱스 탐색이 페이지 전환 중심이라 하위 탐색 중 컨텍스트(확장 상태/스크롤)를 잃기 쉽다.
- 탐색-복귀 반복 비용이 높아 위계형 탐색 UX가 저하된다.

## 현행 홈 라우터 분석 (As-Is)
- 홈 라우터 엔트리 파일은 `src/app/page.tsx`이며, App Router 기준 `/` 요청을 직접 처리한다.
- `src/app/page.tsx`의 `Home` 서버 컴포넌트는 `getAdminSessionFromServerCookies()`로 관리자 세션을 확인하고, 세션이 없으면 `redirect('/admin/login?next=%2F')` 흐름으로 강제 이동시킨다.
- 세션 판별은 `src/lib/admin-auth.ts`의 `getAdminSessionFromServerCookies()`가 `admin_session` 쿠키를 읽어 DB 세션 조회/갱신(`touch`)하는 방식이다.
- 로그인 복귀 흐름은 `src/app/admin/login/page.tsx`의 `next` 정규화 및 `src/app/admin/login/AdminLoginClient.tsx`의 `router.replace(nextPath)`로 구성되어, 비로그인 사용자의 `/` 접근은 최종적으로 `/admin/login?next=/`로 수렴한다.
- 헤더 타이틀 링크(`src/components/HomeTitleLink.tsx`)도 `href="/"`를 사용하므로, 현재 정보구조에서 홈 CTA는 모두 관리자 보호 루트로 연결된다.
- `next.config.ts` 기준으로 `/`에 대한 별도 rewrite/redirect 오버라이드는 없고, 현재 저장소에는 `src/middleware.ts`도 없다(페이지 레벨 가드가 단일 진입 제어 지점).
- 회귀 검증 기준도 동일 계약을 고정한다: `scripts/test-step-5.mjs`(비관리자 `/` 접근 시 로그인 유도), `tests/ui/draft-visibility.spec.ts`(보호 경로의 `next` 파라미터 검증).
- 이 동작은 `2026-02-22` 커밋 `7a3046e`(feat: 포스트 경로 관리자 전용 전환 및 태그 위키 통합) 기준으로 확정되어 있으며, 본 이슈는 해당 관리자 전용 홈을 공개 위키 진입점으로 재전환하는 작업이다.

## 목표
- [ ] `/`를 공개 위키 진입점으로 전환한다.
- [ ] 위키 인덱스 제목을 `댓글 위키`에서 `위키`로 변경한다.
- [ ] 페이지 전환 최소화 기반의 위계형 위키 탐색 UX를 제공한다.
- [ ] 깊은 링크(직접 URL 접근), SEO, 접근성 요구사항을 유지한다.

## 범위
### 포함
- 루트 라우팅 동작 변경 및 위키 인덱스 진입 플로우 정리
- 위키 인덱스 UI를 트리 탐색/상세 패널 구조로 리팩터링
- 브레드크럼, 상위 이동, 활성 노드 하이라이트 등 컨텍스트 유지 UX 보강
- `/wiki/[...path]`와 상태 동기화로 새로고침/공유 시 동일 상태 복원
- 관련 문서(`plans/use-cases.md`, `docs/codebase.md`) 동기화
- `plans/use-cases.md`의 `UC-VISIBILITY-001`(홈 비로그인 리다이렉트 계약)과 위키 헤딩 관련 케이스를 본 이슈 결과에 맞게 갱신

### 제외
- 위키 도메인 모델(테이블 구조) 전면 개편
- 관리자 인증 정책/권한 모델 변경
- 이슈 범위를 벗어나는 디자인 시스템 전면 개편

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
   - [ ] `/` 공개 진입 전환 구현: `src/app/page.tsx` (필요 시 `loading.tsx` 동반)
   - [ ] 위키 탐색 공용 클라이언트 셸 도입(예: `src/components/wiki/WikiExplorerClient.tsx`) 후 `src/app/wiki/page.tsx`/`src/app/wiki/[...path]/page.tsx`에서 재사용
   - [ ] 모바일(360) 탐색 패턴은 탭 전환(트리 탭 / 상세 탭)으로 고정한다.
   - [ ] URL 히스토리 정책: 사용자 클릭 탐색은 `push`, 초기 동기화/동일 경로 재선택은 `replace`를 사용한다.
   - [ ] 초기 진입은 서버 렌더링, 이후 탐색은 클라이언트 상태 + URL `push/replace` 동기화로 유지하고 새로고침 시 동일 path를 초기 상태로 복원
3. [ ] 테스트
4. [ ] 문서화/정리

## 리스크 및 확인 필요 사항
- 트리 상태와 URL 동기화 방식(서버/클라이언트 경계)에 따라 hydration 이슈가 발생할 수 있다.
- 노드 수가 많은 경우 렌더링 비용 증가 가능성이 있어 렌더링 범위 최적화가 필요하다.
- 모바일은 탭 전환 패턴으로 확정했으므로 탭 상태 동기화/접근성 회귀를 중점 관리한다.
- 렌더링 비용이 기준치를 초과하면 단계적으로 완화한다(초기 렌더 범위 제한 -> 지연 로딩 -> 필요 시 가상화 검토).
- hydration mismatch 발생 시 서버 초기 상태를 우선하는 fallback으로 기능/SEO 회귀를 우선 차단한다.

## 완료 기준 (Definition of Done)
- [ ] 비로그인 사용자가 `/`에 접근 시 `200`으로 위키 진입 화면을 확인할 수 있다.
- [ ] 관리자 로그인 상태에서는 기존 빠른 이동 진입점(글 목록/글 작성)을 유지한다(비로그인에는 숨김).
- [ ] 위키 인덱스 주요 헤딩/내비게이션 텍스트가 `위키` 기준으로 일관되다.
- [ ] 모바일(360)에서 탭 전환(트리/상세) UX가 기능/시각 회귀 테스트와 함께 검증된다.
- [ ] URL 히스토리 정책(`push`/`replace`)이 Back/Forward 기대 동작과 일치하게 검증된다.
- [ ] 인플레이스 탐색, Back/Forward 복귀, 새로고침 상태 복원이 자동화 테스트로 검증된다.
- [ ] `npm run test:all`이 통과한다.

## 검증 계획
- [ ] 회귀: `npm run test:all`
- [ ] Playwright 기능 테스트: 인플레이스 탐색, 브레드크럼 복귀, 직접 URL 진입 재현
- [ ] 동적 경로 전환 지연 완화를 위해 `/wiki/[...path]`의 `loading.tsx` 적용 여부를 구현 체크리스트에 포함
- [ ] Playwright UI 테스트: `toHaveScreenshot` (360/768/1440)
- [ ] 시각 회귀는 baseline 생성 환경과 동일한 OS/브라우저 프로젝트에서 실행해 환경 차이 노이즈를 최소화
- [ ] 접근성 검사: `@axe-core/playwright`
- [ ] 영향 회귀 파일 확인: `scripts/test-step-5.mjs`, `tests/ui/draft-visibility.spec.ts`, `tests/ui/wiki-view.spec.ts`, `tests/ui/tags-index.spec.ts`, `tests/ui/visual-regression.spec.ts`
- [ ] `/` 계약 변경 영향 테스트 확인: `tests/ui/home-empty-state.spec.ts`, `tests/ui/home-scroll-top.spec.ts`
- [ ] 비로그인 `/` 접근 시 `200` + 위키 인덱스 렌더링, `/admin/login` 리다이렉트 미발생을 기능 assertion으로 검증
- [ ] 인플레이스 탐색 후 브라우저 Back/Forward에서 활성 노드/브레드크럼/스크롤 상태 복원 검증
- [ ] `/wiki/[...path]` 직접 진입 -> 새로고침 후 동일 경로/패널 상태 유지 검증
- [ ] 위키 인덱스 헤딩 변경(`댓글 위키` -> `위키`)에 대해 기능 assertion + 시각 회귀를 함께 갱신
- [ ] SEO 회귀 확인: 경로 페이지 `title`/`canonical` 메타데이터 유지 검증
- [ ] 배포 전후 Playwright 스모크 체크: `/`, `/wiki`, `/wiki/[...path]` 핵심 경로를 자동 시나리오로 확인
- [ ] 이슈 변경이 문제를 유발하면 홈 공개 전환 커밋 단위로 즉시 롤백 가능한지 확인
