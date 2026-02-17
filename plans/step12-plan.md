# Step 12 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-17
> 연계 문서: `plans/step5-plan.md`, `plans/step9-plan.md`, `docs/codebase.md`
> 본 계획의 구현 순서 기준은 `Phase 3 Step 12`를 따른다.

---

## Step 12: 반응형 디자인 개선 (360/768/1440 기준)

### 목표

- 모바일(360px)에서 가로 스크롤/레이아웃 깨짐 없이 읽기/탐색이 가능하다.
- 태블릿(768px)과 데스크톱(1440px)에서 정보 밀도/가독성 균형을 맞춘다.
- Playwright 스크린샷 회귀(`toHaveScreenshot`) + 핵심 기능 assertion + 접근성 검사(`@axe-core/playwright`)가 통과한다.

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 12-1 | 기준 뷰포트 | `360/768/1440` 고정 | Playwright 프로젝트/스냅샷 기준과 일치 |
| 12-2 | 모바일 내비게이션 | "깨지지 않음" 우선: `flex-wrap` + 터치 타겟 확보, 필요 시 메뉴 토글은 `details/summary` 기반으로 최소 구현 | JS 의존을 최소화하면서도 360px에서 헤더가 무너지지 않게 유지 |
| 12-3 | 마크다운 본문 스타일링 | Tailwind Typography 플러그인 대신 **커스텀 CSS 클래스**(`.markdown-content`)로 제어 | 기존 `/admin/write` 프리뷰(`.markdown-preview`) 패턴과 일관 (`/write`는 `/admin/write`로 리다이렉트), 의존성 추가 최소화 |
| 12-4 | 회귀 판별 | 스크린샷 회귀 + "가로 스크롤 없음" + a11y(serious/critical 0) | 시각적/기능적/접근성 회귀를 동시에 방지 |

---

### 범위

#### In Scope (대상 화면)

- 공개 화면
  - `/`, `/posts`, `/posts/[slug]`, `/tags`, `/tags/[tag]`
- 관리자 화면
  - `/admin/login`, `/admin/write`, `/admin/notes`, `/admin/todos`, `/admin/schedules`
  - (참고) `/write`는 `/admin/write`로 리다이렉트되므로 동일 범위로 포함
- 공통 레이아웃
  - 헤더 내비게이션(로그인/글쓰기/로그아웃 포함), 컨테이너 폭/패딩, 버튼/링크 터치 타겟
- 마크다운 본문 렌더링 영역
  - 코드 블록/표/이미지/긴 URL 등의 오버플로우 대응

#### Out of Scope

- UI 리브랜딩(색/폰트 전면 교체), 다크모드 추가
- 새로운 디자인 시스템/컴포넌트 라이브러리 도입
- 정보 구조(IA) 전면 개편, 라우트 구조 변경

---

### 구현 내용

**12-1. 공통 컨테이너/여백 정리**

- 페이지별로 반복되는 `mx-auto w-full max-w-* px-* py-*` 패턴을 정리한다.
- 동일 성격의 페이지는 같은 max-width 규칙을 사용한다.
  - 목록형: `max-w-5xl`
  - 상세 본문: `max-w-3xl`
  - 폼/로그인: `max-w-md`
- 관리자 테이블/보드 성격 화면(예: `/admin/todos`, `/admin/schedules`)은 정보 밀도를 위해 `max-w-6xl`을 유지/허용한다.
- 360px에서 상하 여백이 과도하지 않도록 기본 `py`를 점검/조정한다.

**12-2. 헤더 내비게이션(모바일) 안정화**

- 360px에서 브랜드/내비게이션이 겹치거나 화면 밖으로 밀리지 않도록 한다.
- 인증 상태에 따라 메뉴 항목이 늘어나도 헤더가 깨지지 않도록 한다.
  - 최소 요구: `flex-wrap` + 아이템 간격/패딩 조정 + `min-w-0`/`truncate`로 텍스트 폭 제어
  - 필요 시: `details/summary` 기반 "메뉴" 토글(모바일 전용)로 세로 메뉴 제공
    - 전환 기준: 위 최소 요구를 적용한 뒤에도 360px에서 오버플로우가 남거나(가로 스크롤/화면 밖 밀림), 줄 수가 과도해(3줄 이상) 헤더 가독성이 깨지면 토글로 전환한다.
- 버튼/링크 터치 타겟은 모바일 기준 최소 40px 근접(높이/패딩) 유지.

**12-3. 목록/카드 레이아웃 개선**

- PostCard/태그 리스트 등 반복 컴포넌트가 360px에서 과도한 줄바꿈/오버플로우를 만들지 않도록 한다.
- 768px 이상에서는 1열 고정이 답답해지지 않도록 정보 밀도를 조절한다.
  - 예: 목록 그리드를 `sm:gap-*`, `lg:grid-cols-2` 등으로 조정(필요 시)
- 태그 칩은 줄바꿈이 자연스럽게 되도록 하고(이미 `flex-wrap`이면 유지), 클릭 영역을 확보한다.

**12-4. 게시글(마크다운) 본문 스타일 + 오버플로우 대응**

- `PostContent`의 렌더링 영역에 `.markdown-content` 클래스를 부여하고 `globals.css`에서 요소별 스타일을 정의한다.
  - 기존 `PostContent`의 `prose prose-slate` 기반 클래스는 제거하고 `.markdown-content`로 일원화한다.
  - 헤딩/리스트/문단 간격을 부여해 Tailwind preflight에 의해 "다 붙는" 문제를 방지한다.
  - 코드 블록(`<pre>`)은 `overflow-x-auto` + 모바일에서 가독성 있는 폰트 크기/패딩을 적용한다.
  - 긴 URL/코드/표가 레이아웃을 깨지 않도록 `overflow-wrap`/`word-break`을 적절히 적용한다.
  - 이미지/비디오는 컨테이너 폭을 넘지 않도록 `max-width: 100%`/`height: auto` 규칙을 적용한다.
  - KaTeX/mermaid가 폭을 넘지 않도록 `.katex-display`, `.mermaid-container`도 동일하게 오버플로우를 제어한다.
  - 표(`<table>`)는 기본은 CSS로 모바일 가로 스크롤을 허용한다(예: `overflow-x: auto`).
    - 래퍼 적용은 필요 시에만 사용한다.
    - 승격 조건: 360px에서 표 때문에 페이지 가로 스크롤이 남거나, 표 스크롤 UX가 불안정하면 래퍼 방식으로 전환한다.
    - 승격 시 작업: markdown 렌더 단계에서 table 래핑 + sanitize 스키마에 래퍼 클래스 허용을 추가한다.

**12-5. Playwright 스크린샷/기능/a11y 회귀 유지**

- 기존 UI 테스트 프로젝트(360/768/1440)를 그대로 사용한다.
- 스타일 변경으로 스냅샷이 변경되는 경우, 의도된 변경만 반영되도록 스냅샷을 갱신한다.
- "가로 스크롤 없음"을 자동 검증한다.
  - 예: `Math.ceil(scrollWidth) <= clientWidth + 1` (1px 허용) assertion

---

### 영향 파일 (예상)

- 레이아웃/스타일
  - `src/app/layout.tsx`
  - `src/app/globals.css`
- 공개 페이지/컴포넌트
  - `src/app/page.tsx`
  - `src/app/posts/page.tsx`
  - `src/app/posts/[slug]/page.tsx`
  - `src/app/tags/page.tsx`
  - `src/app/tags/[tag]/page.tsx`
  - `src/app/admin/login/AdminLoginClient.tsx`
  - `src/app/admin/write/AdminWriteClient.tsx`
  - `src/app/admin/notes/AdminNotesClient.tsx`
  - `src/app/admin/todos/AdminTodosClient.tsx`
  - `src/app/admin/schedules/AdminSchedulesClient.tsx`
  - `src/components/PostCard.tsx`
  - `src/components/PostContent.tsx`
  - `src/components/AdminAuthNavButton.tsx`
- UI 테스트(스냅샷 포함)
  - `tests/ui/helpers.ts`
  - `tests/ui/visual-regression.spec.ts` 및 `*-snapshots/*`
  - `tests/ui/admin-workspace.spec.ts`
  - `tests/ui/write-link-auth.spec.ts`
  - `tests/ui/post-admin-actions.spec.ts`
  - `tests/ui/write-typography.spec.ts`
  - 필요 시: 모바일 내비게이션/오버플로우 검증 전용 spec 추가

---

### 통과 기준 (Gate Criteria)

- (공통) 모바일(360)에서 가로 스크롤이 생기지 않는다.
- (공개) `/`, `/posts`, `/posts/[slug]`, `/tags`, `/tags/[tag]`가 360/768/1440에서 레이아웃 깨짐 없이 읽힌다.
- (관리자) `/admin/*` 주요 화면이 360/768/1440에서 레이아웃 깨짐 없이 조작 가능하다.
- (본문) 코드 블록/표/이미지/긴 텍스트가 레이아웃을 밀어내지 않는다.
- Playwright:
  - 스크린샷 회귀 통과
  - 핵심 기능 assertion 통과
  - a11y serious/critical 위반 0
- 회귀 규칙: 변경 후 `npm run test:all` 통과

---

### 자동화 실행

```bash
npm run test:ui
npm run test:all
```

---

### 테스트 항목 (예시)

1. **가로 스크롤 없음(360/768/1440)**
   - 대상 경로: `/`, `/posts`, `/posts/[slug]`, `/tags`, `/admin/login`, `/admin/write`
   - 기대 결과(예): `Math.ceil(scrollWidth) <= clientWidth + 1` (1px 허용)
   - 자동 검증 위치(예): `tests/ui/visual-regression.spec.ts`, `tests/ui/admin-workspace.spec.ts`

2. **헤더 내비게이션 깨짐 없음**
   - 로그인 전: 메뉴가 360px에서 두 줄로 넘어가더라도 클릭 가능/겹침 없음
   - 로그인 후: `글쓰기`, `로그아웃`이 추가되어도 동일

3. **게시글 본문 오버플로우**
   - 고정 시드 데이터로 오버플로우 전용 글을 준비한다.
     - 긴 코드(단일 라인), 긴 URL, 다중 컬럼 표, 큰 이미지 포함
   - 글 상세 페이지에서 확인한다.
   - 기대 결과: 페이지 전체는 가로 스크롤 없음, 필요한 경우만 가로 스크롤(코드/표)

4. **스크린샷 회귀**
   - 기존 `tests/ui/visual-regression.spec.ts` + 관리자 워크스페이스 스냅샷들이 모두 통과

5. **접근성 검사**
   - 주요 페이지 serious/critical 위반 0
