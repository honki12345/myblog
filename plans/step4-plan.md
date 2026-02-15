# Step 4 구현 계획서

> 원본: `plans/implementation-plan.md`
> 작성일: 2026-02-15
> 연계 문서: `plans/implementation-plan.md`, `plans/blog-architecture.md`, `plans/step3-plan.md`

---

### Step 4: 마크다운 렌더링 파이프라인

#### 사전 결정 사항

| # | 항목 | 결정 | 핵심 이유 |
|---|------|------|-----------|
| 4-1 | rehypeSanitize 스키마 | 최소 허용 원칙: shiki `span[style]`, KaTeX MathML 태그/`katex-*` class, mermaid `data-chart` 허용 | 안전+기능 양립. XSS 차단하면서 렌더링 깨짐 방지 |
| 4-2 | Shiki 테마/언어 | `@shikijs/rehype` + `github-dark` + 핵심 10개 언어 (js, ts, python, bash, json, sql, html, css, md, yaml) | 1GB RAM에서 메모리 절약. 미지원 언어는 일반 텍스트로 표시 |
| 4-3 | Mermaid 변환 | 커스텀 rehype 플러그인 (rehypeShiki 후, rehypeSanitize 전). `data-chart`에 base64 인코딩 | 서버에서 placeholder 생성, 클라이언트에서 렌더링 |
| 4-4 | KaTeX CSS | 로컬 번들 (`import 'katex/dist/katex.min.css'`) | 외부 CDN 의존성 제거, 네트워크 의존성 축소 |

> **의존성 영향**: sanitize 스키마 → Step 5 렌더링 품질 / shiki 언어 수 → Step 7 메모리 / KaTeX CSS → Step 5 layout.tsx / Mermaid 변환 → Step 5 MermaidDiagram 컴포넌트

#### 선행 조건 (Preflight)

- 의존성 설치:
  - `npm install remark-gfm remark-math rehype-katex rehype-sanitize unified remark-parse remark-rehype rehype-stringify @shikijs/rehype mermaid katex`
- 스크립트 등록:
  - `package.json`에 `"test:step4": "node scripts/test-step-4.mjs"` 추가
  - Step 4 구현 완료 시 `test:all`에 Step 4 포함:
    - 예: `"test:all": "npm run test:step1 && npm run test:step2 && npm run test:step3 && npm run test:step4 && npm run test:ui"`
- Step 4 영향 파일:
  - `src/lib/markdown.ts`
  - `src/components/PostContent.tsx`
  - `src/components/MermaidDiagram.tsx`
  - `src/app/layout.tsx`
  - `scripts/test-step-4.mjs`
  - `package.json`, `package-lock.json`

#### 구현 착수 체크포인트

- `src/lib/markdown.ts`의 Step 1 placeholder 파서를 unified 기반 렌더링 파이프라인으로 교체한다.
- `src/components/PostContent.tsx`의 placeholder 호출(`markdownToHtml`)을 Step 4 표준 렌더러 인터페이스(`renderMarkdown`) 기준으로 정렬한다.
- `src/components/MermaidDiagram.tsx`의 placeholder 출력(`<pre data-placeholder="mermaid-raw">`)을 실제 Mermaid 렌더링 로직으로 교체한다.
- `scripts/test-step-4.mjs` placeholder를 Gate Criteria 검증 코드로 교체한다.
- 위 항목 완료 후 Gate 테스트(`npm run test:step4`, `npm run test:all`)를 실행한다.

#### 운영 확정값 (관점 5 반영)

- Step 4 마크다운 파이프라인 의존성은 `package-lock.json` 기준으로 고정 배포한다.
- Shiki 언어 수는 10개를 상한으로 유지하고, 신규 언어 추가는 메모리 측정 결과를 근거로 별도 승인 후 반영한다.
- sanitize 허용 스키마 변경 시 XSS/sanitize 회귀 테스트를 필수로 재실행한다.

#### 구현 내용

**4-1. `src/lib/markdown.ts` — 서버 사이드 렌더링**

```
마크다운 원문 (string)
  │
  ▼
unified()
  .use(remarkParse)          ← 마크다운 파싱
  .use(remarkGfm)            ← GFM (취소선, 체크박스, 각주 등)
  .use(remarkMath)           ← 수학 수식 ($...$, $$...$$)
  .use(remarkRehype)         ← HTML 변환
  .use(rehypeShiki, {        ← 코드 하이라이팅
    theme: 'github-dark'
  })
  .use(rehypeKatex)          ← 수식 렌더링
  .use(rehypeSanitize, {     ← XSS 방지 (커스텀 스키마)
    ...defaultSchema,
    // shiki, katex, mermaid가 생성하는 class/style 허용
  })
  .use(rehypeStringify)      ← HTML 출력
  │
  ▼
HTML string (안전)
```

핵심 포인트:
- **rehypeSanitize 커스텀 스키마**: shiki가 생성하는 `style` 속성과 katex가 사용하는 class 허용 필요
- **Mermaid는 서버에서 처리하지 않음**: `` ```mermaid `` 코드 블록을 `<div class="mermaid-container" data-chart="...">` 형태로 변환, 클라이언트에서 렌더링
- **파이프라인 보안 원칙**: `rehypeSanitize` 이후 단계는 신뢰 가능한 플러그인만 허용하고, 비신뢰 플러그인 연결은 금지한다.

**4-2. `src/components/MermaidDiagram.tsx` — 클라이언트 렌더링**

```tsx
'use client';
// dynamic import로 mermaid 라이브러리 로드
// data-chart 속성에서 다이어그램 코드를 읽어 렌더링
// 로딩 중 폴백 UI 표시
```

**4-3. KaTeX CSS**

- `src/app/layout.tsx`에서 `import 'katex/dist/katex.min.css'`로 로컬 번들을 포함한다.

#### 통과 기준 (Gate Criteria)

- 각 Tier(1~4)의 마크다운 문법이 올바르게 HTML로 변환된다.
- XSS 위험 요소가 sanitize되어 악성 스크립트가 제거된다.
- shiki 코드 하이라이팅, KaTeX 수식, Mermaid placeholder가 정상 출력된다.
- sanitize 커스텀 스키마가 shiki의 `style`과 KaTeX의 `class`를 허용하면서 악성 입력은 차단한다.

#### 완료 정의 (Definition of Done)

- `npm run test:step4`가 종료 코드 `0`으로 완료된다.
- `npm run test:all`이 Step 4 포함 구성으로 종료 코드 `0`을 반환한다.
- Step 4 영향 파일의 placeholder 구현이 제거된다.

#### 리스크 및 대응

- 대형 마크다운 입력(초대형 코드블록/다수 Mermaid 블록)으로 렌더링 시간이 급증할 수 있다.
  - 대응: 대용량 성능 테스트를 CI에 유지하고, 기준치 초과 시 경고를 배포 게이트에서 확인한다.
- sanitize 화이트리스트가 과도하면 XSS 차단 강도가 약해질 수 있다.
  - 대응: 허용 속성/태그 추가 시 XSS 테스트와 shiki style 보존 테스트를 동시에 재실행한다.
- Mermaid 렌더링 실패 시 사용자 화면 품질이 저하될 수 있다.
  - 대응: Mermaid 컴포넌트에 폴백 UI를 유지하고, 실패 케이스를 Playwright 회귀 시나리오에 포함한다.

#### 범위 경계 (Out of Scope)

- Mermaid 서버 사이드 SVG 사전 렌더링은 Step 4 범위에서 제외한다.
- 코드 하이라이트 테마 다중 선택 UI는 Step 4 범위에서 제외한다.
- WYSIWYG 에디터 도입은 Step 4 범위에서 제외한다.

#### 자동화 실행

```bash
npm run test:step4
npm run test:all
```

> `scripts/test-step-4.mjs` — Tier 1~4 렌더링, XSS sanitize, shiki style 보존, 대용량 성능 테스트를 한 번에 실행.
> 서버 불필요 (순수 라이브러리 함수 테스트). `src/lib/markdown.ts`를 직접 import하여 테스트.

#### 테스트 목록

1. **Tier 1: 기본 마크다운 렌더링** (`scripts/test-step-4.mjs`)
   ```js
   import { renderMarkdown } from '../src/lib/markdown.ts';

   const input = `# 제목

본문 **볼드** *이탤릭* \`인라인 코드\`

- 항목 1
- 항목 2

1. 순서 1
2. 순서 2

[링크](https://example.com)

![이미지](https://example.com/img.png)

> 인용문

---

| 컬럼1 | 컬럼2 |
|-------|-------|
| 데이터1 | 데이터2 |
`;
   const html = await renderMarkdown(input);

   const checks = [
     ['<h1', '제목 태그'],
     ['<strong', '볼드'],
     ['<em', '이탤릭'],
     ['<code', '인라인 코드'],
     ['<ul', '비순서 목록'],
     ['<ol', '순서 목록'],
     ['<a ', '링크'],
     ['<img ', '이미지'],
     ['<blockquote', '인용문'],
     ['<hr', '수평선'],
     ['<table', '테이블'],
   ];

   let allPassed = true;
   for (const [tag, name] of checks) {
     if (!html.includes(tag)) {
       console.error(`FAIL: ${name} (${tag}) not found`);
       allPassed = false;
     }
   }
   if (allPassed) console.log('TIER 1 ALL PASSED');
   ```

2. **Tier 2: GFM 확장 렌더링**
   ```js
   const input = `
~~취소선~~

- [x] 완료된 할 일
- [ ] 미완료 할 일

https://example.com 자동 링크

각주 참조[^1]

[^1]: 각주 내용
`;
   const html = await renderMarkdown(input);

   const checks = [
     ['<del', '취소선'],
     ['type="checkbox"', '체크박스'],
     ['<a href="https://example.com"', '자동 링크'],
   ];

   let allPassed = true;
   for (const [tag, name] of checks) {
     if (!html.includes(tag)) {
       console.error(`FAIL: ${name} (${tag}) not found`);
       allPassed = false;
     }
   }
   if (allPassed) console.log('TIER 2 ALL PASSED');
   ```

3. **Tier 3: 코드 하이라이팅 (shiki)**
   ```js
   const input = '```javascript\nconst x = 42;\nconsole.log(x);\n```';
   const html = await renderMarkdown(input);

   const hasStyle = html.includes('style=');
   const hasPreCode = html.includes('<pre') && html.includes('<code');

   if (hasStyle && hasPreCode) {
     console.log('TIER 3 PASSED: shiki code highlighting working');
   } else {
     console.error('TIER 3 FAILED');
   }
   ```

4. **Tier 4-1: KaTeX 수식 렌더링**
   ```js
   const input = `인라인 수식: $E = mc^2$

블록 수식:

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$
`;
   const html = await renderMarkdown(input);
   const hasKatex = html.includes('katex') || html.includes('math');

   if (hasKatex) {
     console.log('TIER 4-1 PASSED: KaTeX rendering working');
   } else {
     console.error('TIER 4-1 FAILED');
   }
   ```

5. **Tier 4-2: Mermaid placeholder 변환**
   ```js
   const input = '```mermaid\ngraph TD\n  A --> B\n  B --> C\n```';
   const html = await renderMarkdown(input);

   const hasMermaidContainer = html.includes('mermaid-container') || html.includes('mermaid');
   const hasChartData = html.includes('graph TD') || html.includes('data-chart');

   if (hasMermaidContainer && hasChartData) {
     console.log('TIER 4-2 PASSED: Mermaid placeholder created');
   } else {
     console.error('TIER 4-2 FAILED');
     console.log(html);
   }
   ```

6. **XSS sanitize 검증 — 스크립트 태그 제거**
   ```js
   const malicious = `
# 정상 제목

<script>alert('XSS')</script>

일반 텍스트

<img src=x onerror="alert('XSS')">

<a href="javascript:alert('XSS')">클릭</a>

<div onmouseover="alert('XSS')">호버</div>
`;
   const html = await renderMarkdown(malicious);

   const xssPatterns = ['<script', 'onerror=', 'javascript:', 'onmouseover=', 'alert('];

   let safe = true;
   for (const pattern of xssPatterns) {
     if (html.includes(pattern)) {
       console.error(`XSS FOUND: ${pattern}`);
       safe = false;
     }
   }
   if (!html.includes('<h1') || !html.includes('정상 제목')) {
     console.error('SANITIZE TOO AGGRESSIVE: normal content removed');
     safe = false;
   }

   if (safe) console.log('XSS SANITIZE TEST PASSED');
   else { console.error('XSS SANITIZE TEST FAILED'); process.exit(1); }
   ```

7. **sanitize 커스텀 스키마 — shiki style 보존 확인**
   ```js
   const input = '```python\ndef hello():\n    print("world")\n```';
   const html = await renderMarkdown(input);

   if (html.includes('style=') && html.includes('<pre')) {
     console.log('SHIKI STYLE PRESERVED: PASSED');
   } else {
     console.error('SHIKI STYLE REMOVED BY SANITIZE: FAILED');
   }
   ```

8. **대용량 마크다운 렌더링 성능 테스트**
   ```js
   let bigContent = '# 대용량 테스트\n\n';
   for (let i = 0; i < 500; i++) {
     bigContent += `## 섹션 ${i}\n\n이것은 테스트 문단입니다. `.repeat(10) + '\n\n';
     bigContent += '```javascript\nconsole.log("test");\n```\n\n';
   }

   const start = Date.now();
   const html = await renderMarkdown(bigContent);
   const elapsed = Date.now() - start;

   console.log(`렌더링 시간: ${elapsed}ms, HTML 크기: ${html.length} bytes`);
   if (elapsed < 10000) {
     console.log('PERFORMANCE TEST PASSED');
   } else {
     console.error('PERFORMANCE TEST FAILED: too slow');
   }
   ```

9. **API를 통한 마크다운 저장 및 조회 통합 테스트**
   ```bash
   curl -s -X POST http://localhost:3000/api/posts \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{
       "title": "마크다운 테스트",
       "content": "# 제목\n\n```python\nprint(\"hello\")\n```\n\n$E=mc^2$",
       "status": "published"
     }'

   # 개별 글 페이지에서 렌더링 확인
   curl -s http://localhost:3000/posts/마크다운-테스트 | grep -c "<pre"
   ```
   - 기대 결과: API 생성 성공, 페이지에서 `<pre` 태그 1개 이상

10. **실서비스 유사 UI 렌더링 회귀 테스트 (Playwright)**
   - 대상: `/posts/[slug]` 개별 글 페이지
   - 검증:
     - 코드 블록, KaTeX 수식, Mermaid 영역이 실제 브라우저에서 렌더링되는지 assertion
     - 스크린샷 회귀(`toHaveScreenshot`)를 뷰포트 `360`, `768`, `1440`에서 수행
     - `@axe-core/playwright` 접근성 검사 최소 1회 수행
   - 안정화:
     - 애니메이션 비활성화, 고정 시드 데이터, 고정 타임존/로케일 적용
     - 실패 시 diff 이미지를 CI 아티팩트로 보관

11. **대용량 렌더링 성능 기준 보완**
   - 기존 10초 기준은 절대 합격선이 아니라 경고 임계값으로 사용한다.
   - CI/로컬 실행 환경 편차를 고려해 단일 수치보다 추세(이전 대비 급격한 증가 여부)를 함께 기록한다.

#### 피드백 루프

- 이전 단계: sanitize가 너무 엄격하면 Step 3에서 저장한 마크다운이 올바르게 렌더링되지 않을 수 있음
- 다음 단계: 렌더링 실패 시 Step 5의 개별 글 페이지가 빈 화면. shiki 메모리 과도 시 Step 7 배포 문제.
- 회귀 테스트: sanitize 스키마 변경 시 XSS 테스트와 shiki style 보존 테스트 반드시 재실행

---

## 보충사항 (Addendum)

### Step 4 실행 전 확정 필요 항목

| # | 항목 | 선택지 |
|---|------|--------|
| 1 | `renderMarkdown` 인터페이스 | A) `async` 고정 / B) `sync` 유지 |
| 2 | Mermaid 입력 제한 | A) 블록 길이/개수 상한 적용 / B) 무제한 |
| 3 | sanitize 변경 승인 절차 | A) PR 체크리스트 필수 / B) 권장 |
| 4 | 성능 임계 초과 정책 | A) 배포 차단 / B) 경고만 |
