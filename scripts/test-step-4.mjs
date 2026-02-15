import process from "node:process";

const markdownModule = await import("../src/lib/markdown.ts");
const markdownExports = markdownModule.default ?? markdownModule;
const { MERMAID_MAX_BLOCKS, MERMAID_MAX_CHART_BYTES, renderMarkdown } =
  markdownExports;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(html, fragment, message) {
  assert(html.includes(fragment), `${message} (${fragment})`);
}

function readPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

async function testTier1BasicMarkdown() {
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
    ["<h1", "제목 태그"],
    ["<strong", "볼드"],
    ["<em", "이탤릭"],
    ["<code", "인라인 코드"],
    ["<ul", "비순서 목록"],
    ["<ol", "순서 목록"],
    ["<a ", "링크"],
    ["<img ", "이미지"],
    ["<blockquote", "인용문"],
    ["<hr", "수평선"],
    ["<table", "테이블"],
  ];

  for (const [fragment, name] of checks) {
    assertIncludes(html, fragment, `TIER 1 실패: ${name}`);
  }

  console.log("TIER 1 PASSED");
}

async function testTier2Gfm() {
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
    ["<del", "취소선"],
    ['type="checkbox"', "체크박스"],
    ['<a href="https://example.com"', "자동 링크"],
  ];

  for (const [fragment, name] of checks) {
    assertIncludes(html, fragment, `TIER 2 실패: ${name}`);
  }

  console.log("TIER 2 PASSED");
}

async function testTier3Shiki() {
  const input = "```javascript\nconst x = 42;\nconsole.log(x);\n```";
  const html = await renderMarkdown(input);

  assertIncludes(html, "<pre", "TIER 3 실패: pre 누락");
  assertIncludes(html, "<code", "TIER 3 실패: code 누락");
  assertIncludes(html, "style=", "TIER 3 실패: shiki style 누락");

  console.log("TIER 3 PASSED");
}

async function testTier4Katex() {
  const input = `인라인 수식: $E = mc^2$

블록 수식:

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$
`;
  const html = await renderMarkdown(input);

  assert(
    html.includes("katex") || html.includes("<math"),
    "TIER 4-1 실패: KaTeX 렌더링 결과 누락",
  );

  console.log("TIER 4-1 PASSED");
}

async function testTier4MermaidPlaceholder() {
  const input = "```mermaid\ngraph TD\n  A --> B\n  B --> C\n```";
  const html = await renderMarkdown(input);

  assertIncludes(
    html,
    'class="mermaid-container"',
    "TIER 4-2 실패: Mermaid container 누락",
  );
  assertIncludes(html, "data-chart=", "TIER 4-2 실패: Mermaid data-chart 누락");

  const match = html.match(/data-chart="([^"]+)"/);
  assert(match?.[1], "TIER 4-2 실패: data-chart 추출 실패");

  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  assert(
    decoded.includes("graph TD") && decoded.includes("A --> B"),
    "TIER 4-2 실패: Mermaid chart 복원 실패",
  );

  console.log("TIER 4-2 PASSED");
}

async function testXssSanitize() {
  const malicious = `
# 정상 제목

<script>alert('XSS')</script>

일반 텍스트

<img src=x onerror="alert('XSS')">

<a href="javascript:alert('XSS')">클릭</a>

<div onmouseover="alert('XSS')">호버</div>
`;

  const html = await renderMarkdown(malicious);
  const blockedPatterns = [
    "<script",
    "onerror=",
    "javascript:",
    "onmouseover=",
    "alert(",
  ];

  for (const pattern of blockedPatterns) {
    assert(!html.includes(pattern), `XSS sanitize 실패: ${pattern} 잔존`);
  }

  assertIncludes(html, "<h1", "XSS sanitize 실패: 정상 제목 제거");
  assertIncludes(html, "정상 제목", "XSS sanitize 실패: 정상 본문 제거");

  console.log("XSS SANITIZE PASSED");
}

async function testRawHtmlStyleInjectionBlocked() {
  const input =
    '<span style="background-image:url(javascript:alert(1))">스타일공격</span>';
  const html = await renderMarkdown(input);

  assert(
    !html.includes("<span"),
    "RAW HTML 필터 실패: span 태그가 남아있습니다",
  );
  assert(
    !html.includes("background-image"),
    "RAW HTML 필터 실패: style 속성이 남아있습니다",
  );
  assert(
    !html.includes("javascript:"),
    "RAW HTML 필터 실패: javascript 스킴이 남아있습니다",
  );
  assertIncludes(
    html,
    "스타일공격",
    "RAW HTML 필터 실패: 정상 텍스트가 제거되었습니다",
  );

  console.log("RAW HTML STYLE INJECTION PASSED");
}

async function testShikiStylePreservedAfterSanitize() {
  const input = '```python\ndef hello():\n    print("world")\n```';
  const html = await renderMarkdown(input);

  assertIncludes(
    html,
    "style=",
    "sanitize 실패: shiki style 속성이 제거되었습니다",
  );
  assertIncludes(html, "<pre", "sanitize 실패: pre 누락");

  console.log("SANITIZE + SHIKI STYLE PASSED");
}

async function testMermaidLimits() {
  const manyBlocks = Array.from(
    { length: MERMAID_MAX_BLOCKS + 1 },
    (_, index) => `\`\`\`mermaid\ngraph TD\n  A${index} --> B${index}\n\`\`\``,
  ).join("\n\n");

  const manyBlocksHtml = await renderMarkdown(manyBlocks);
  const containerCount = (
    manyBlocksHtml.match(/class="mermaid-container"/g) ?? []
  ).length;

  assert(
    containerCount === MERMAID_MAX_BLOCKS,
    `Mermaid 블록 상한 실패: expected ${MERMAID_MAX_BLOCKS}, received ${containerCount}`,
  );

  const oversizedBody = "A".repeat(MERMAID_MAX_CHART_BYTES + 1);
  const oversizedInput = `\`\`\`mermaid\ngraph TD\n${oversizedBody}\n\`\`\``;
  const oversizedHtml = await renderMarkdown(oversizedInput);

  assert(
    !oversizedHtml.includes('class="mermaid-container"'),
    "Mermaid 크기 상한 실패: oversized 블록이 변환되었습니다",
  );
  assertIncludes(
    oversizedHtml,
    "language-mermaid",
    "Mermaid 크기 상한 실패: oversized 블록 fallback 누락",
  );

  console.log("MERMAID LIMITS PASSED");
}

async function testPerformanceWarning() {
  const sectionCount = readPositiveIntegerEnv("STEP4_PERF_SECTIONS", 500);
  const warningThresholdMs = readPositiveIntegerEnv(
    "STEP4_PERF_THRESHOLD_MS",
    10000,
  );

  let bigContent = "# 대용량 테스트\n\n";
  for (let index = 0; index < sectionCount; index += 1) {
    bigContent += `## 섹션 ${index}\n\n${"이것은 테스트 문단입니다. ".repeat(10)}\n\n`;
    bigContent += '```javascript\nconsole.log("test");\n```\n\n';
  }

  const startedAt = Date.now();
  const html = await renderMarkdown(bigContent);
  const elapsedMs = Date.now() - startedAt;

  assert(html.length > 0, "PERFORMANCE TEST 실패: HTML 결과가 비었습니다");
  console.log(`렌더링 시간: ${elapsedMs}ms, HTML 크기: ${html.length} bytes`);

  if (elapsedMs > warningThresholdMs) {
    console.warn(
      `PERFORMANCE WARNING: 렌더링 시간이 경고 임계값(${warningThresholdMs}ms)을 초과했습니다.`,
    );
  } else {
    console.log("PERFORMANCE TEST PASSED");
  }
}

async function main() {
  await testTier1BasicMarkdown();
  await testTier2Gfm();
  await testTier3Shiki();
  await testTier4Katex();
  await testTier4MermaidPlaceholder();
  await testXssSanitize();
  await testRawHtmlStyleInjectionBlocked();
  await testShikiStylePreservedAfterSanitize();
  await testMermaidLimits();
  await testPerformanceWarning();
}

main()
  .then(() => {
    console.log("Step 4 checks passed.");
  })
  .catch((error) => {
    console.error("Step 4 checks failed:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
