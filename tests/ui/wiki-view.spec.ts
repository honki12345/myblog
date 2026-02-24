import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  assertNoHorizontalPageScroll,
  authenticateAdminSession,
  insertCommentDirect,
  insertPostDirect,
  runCleanupScript,
  waitForDocumentTitle,
  type SeededPost,
} from "./helpers";

const DISABLE_ANIMATION_STYLE = `
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

function getWikiDiffThreshold(projectName: string): number {
  if (projectName === "mobile-360") {
    return 0.04;
  }
  if (projectName === "tablet-768") {
    return 0.05;
  }
  return 0.03;
}

async function expectNoSeriousA11y(page: Page) {
  await waitForDocumentTitle(page);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((item) => {
    return item.impact === "critical" || item.impact === "serious";
  });
  expect(blocking).toEqual([]);
}

test.beforeEach(() => {
  runCleanupScript();
});

test("admin manages post comments and wiki pages expose only visible comments", async ({
  page,
}, testInfo) => {
  const seed: SeededPost = {
    title: "PW-SEED-WIKI-COMMENTS",
    content: "위키 댓글 관리 테스트 대상 본문",
    tags: ["wiki", "comments"],
    status: "published",
    sourceUrl: "https://playwright.seed/wiki-comments-source",
    origin: "ai",
  };

  const created = await insertPostDirect(page.request, seed);

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await authenticateAdminSession(page, { nextPath: `/posts/${created.slug}` });
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await expect(
    page.getByRole("heading", { name: "댓글 위키 관리" }),
  ).toBeVisible();
  await expect(
    page.locator("[data-post-comments-admin] [data-comment-list] li"),
  ).toHaveCount(0);

  await page.getByLabel("댓글 내용").fill("첫 댓글: 위키 루트 경로");
  await page.getByLabel("태그 경로").fill("AI/Platform");
  await page.getByRole("button", { name: "댓글 추가" }).click();
  await expect(page.getByText("댓글을 추가했습니다.")).toBeVisible();

  await expect(
    page.locator("[data-comment-list] [data-comment-id]").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "수정" }).first().click();
  await page.getByLabel("댓글 내용").fill("수정된 댓글: nextjs 하위 경로");
  await page.getByLabel("태그 경로").fill("ai/platform/nextjs");
  await page.getByRole("button", { name: "댓글 저장" }).click();
  await expect(page.getByText("댓글을 수정했습니다.")).toBeVisible();

  await page.getByLabel("댓글 내용").fill("숨김 댓글: 노출되면 안 됨");
  await page.getByLabel("태그 경로").fill("ai/platform/hidden");
  await page.getByLabel("숨김 처리").check();
  await page.getByRole("button", { name: "댓글 추가" }).click();
  await expect(page.getByText("댓글을 추가했습니다.")).toBeVisible();

  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /posts/${created.slug} has horizontal overflow`,
  );
  await expectNoSeriousA11y(page);
  await expect(page.locator("main")).toHaveScreenshot(
    "post-detail-comments-admin.png",
    {
      maxDiffPixelRatio: getWikiDiffThreshold(testInfo.project.name),
    },
  );

  await page.goto("/wiki", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
  await expect(
    page.getByRole("heading", { name: "위키", level: 1, exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === "mobile-360") {
    await expect(page.getByRole("button", { name: "트리" })).toBeVisible();
    await expect(page.getByRole("button", { name: "상세" })).toBeVisible();
  }
  await expect(
    page
      .locator("[data-wiki-tree-panel]")
      .getByRole("link", { name: "ai", exact: true }),
  ).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /wiki has horizontal overflow`,
  );
  await expectNoSeriousA11y(page);
  await expect(page).toHaveScreenshot("wiki-index.png", {
    maxDiffPixelRatio: getWikiDiffThreshold(testInfo.project.name),
  });

  let delayOnce = true;
  await page.route("**/api/wiki?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      delayOnce &&
      requestUrl.searchParams.get("q") === "nextjs" &&
      requestUrl.searchParams.get("tagPath") === "ai/platform"
    ) {
      delayOnce = false;
      await page.waitForTimeout(180);
    }
    await route.continue();
  });

  await page.locator("[data-wiki-search-q]").fill("nextjs");
  await page.locator("[data-wiki-search-tag-path]").fill("ai/platform");
  await page.locator("[data-wiki-search-submit]").click();
  await expect(page.locator("[data-wiki-search-submit]")).toHaveText(
    "검색 중...",
  );
  await expect(
    page.locator("[data-wiki-search-results]").getByText('내용: "nextjs"'),
  ).toBeVisible();
  await expect(page.getByText("수정된 댓글: nextjs 하위 경로")).toBeVisible();
  await expect(page.getByRole("button", { name: "검색 해제" })).toBeVisible();
  await expect(
    page
      .locator("[data-wiki-search-results]")
      .getByRole("link", { name: "블로그 글 보기", exact: true }),
  ).toHaveAttribute("href", `/posts/${created.slug}`);
  const searchCommentCard = page
    .locator("[data-wiki-search-results] [data-wiki-comment-card]")
    .filter({ hasText: "수정된 댓글: nextjs 하위 경로" })
    .first();
  await expect(
    searchCommentCard.locator("[data-wiki-comment-meta-left]"),
  ).toContainText("/ai/platform/nextjs");
  await expect(
    searchCommentCard.locator("[data-wiki-comment-post-title]"),
  ).toHaveText(seed.title);
  await expect(
    searchCommentCard.locator("[data-wiki-comment-meta-right]"),
  ).toContainText("업데이트:");
  await expect(
    searchCommentCard.locator("[data-wiki-comment-links]"),
  ).not.toContainText(seed.title);
  await expect(
    searchCommentCard.locator("[data-wiki-comment-links]"),
  ).toContainText("블로그 글 보기");
  await expect(
    searchCommentCard.locator("[data-wiki-comment-links]"),
  ).toContainText("원문 링크");

  // Newer search results should win even if an earlier request resolves later.
  await page.unroute("**/api/wiki?*");
  await page.route("**/api/wiki?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const q = requestUrl.searchParams.get("q");
    const buildPayload = (content: string, commentId: number) => ({
      query: {
        q,
        tagPath: "ai/platform",
        path: null,
        sort: "relevance",
        limit: 120,
      },
      totalCount: 1,
      truncated: false,
      items: [
        {
          commentId,
          postId: created.id,
          content,
          tagPath: "ai/platform",
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:00.000Z",
          postSlug: created.slug,
          postTitle: seed.title,
          postOrigin: "ai",
          postPublishedAt: "2026-02-24T00:00:00.000Z",
          sourceUrl: seed.sourceUrl ?? null,
          relevance: 90,
        },
      ],
    });

    if (q === "slow-keyword") {
      await page.waitForTimeout(220);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildPayload("느린 검색 결과", 8001)),
      });
      return;
    }

    if (q === "fast-keyword") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildPayload("빠른 검색 결과", 8002)),
      });
      return;
    }

    await route.continue();
  });

  await page.locator("[data-wiki-search-q]").fill("slow-keyword");
  await page.locator("[data-wiki-search-tag-path]").fill("ai/platform");
  await page.locator("[data-wiki-search-submit]").click();
  await page.locator("[data-wiki-search-q]").fill("fast-keyword");
  await page.locator("[data-wiki-search-tag-path]").fill("ai/platform");
  await page.locator("[data-wiki-search-submit]").click();
  await expect(page.getByText("빠른 검색 결과")).toBeVisible();
  await page.waitForTimeout(260);
  await expect(page.getByText("빠른 검색 결과")).toBeVisible();
  await expect(page.getByText("느린 검색 결과")).toHaveCount(0);
  await page.unroute("**/api/wiki?*");

  await page.locator("[data-wiki-search-q]").fill("no-match-keyword");
  await page.locator("[data-wiki-search-tag-path]").fill("ai/platform");
  await page.locator("[data-wiki-search-submit]").click();
  await expect(
    page.getByText("조건에 맞는 댓글을 찾지 못했습니다."),
  ).toBeVisible();

  await page.locator("[data-wiki-search-q]").fill("nextjs");
  await page.locator("[data-wiki-search-tag-path]").fill("bad/path/");
  await page.locator("[data-wiki-search-submit]").click();
  await expect(
    page.getByText(
      "tagPath must match ^[a-z0-9-]+(?:/[a-z0-9-]+)*$ (lowercase path segments).",
    ),
  ).toBeVisible();
  await page.locator("[data-wiki-search-q]").fill("");
  await page.locator("[data-wiki-search-tag-path]").fill("");
  await page.locator("[data-wiki-search-submit]").click();
  await expect(
    page.getByText("검색어 또는 태그 경로를 입력해 주세요."),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-wiki-search-results]")
      .getByRole("button", { name: "다시 시도" }),
  ).toHaveCount(0);

  let failOnce = true;
  await page.route("**/api/wiki?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      failOnce &&
      requestUrl.searchParams.get("q") === "nextjs" &&
      requestUrl.searchParams.get("tagPath") === "ai/platform"
    ) {
      failOnce = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "임시 검색 오류",
            details: null,
          },
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.locator("[data-wiki-search-q]").fill("nextjs");
  await page.locator("[data-wiki-search-tag-path]").fill("ai/platform");
  await page.locator("[data-wiki-search-submit]").click();
  await expect(page.getByText("임시 검색 오류")).toBeVisible();
  await page
    .locator("[data-wiki-search-results]")
    .getByRole("button", { name: "다시 시도" })
    .click();
  await expect(page.getByText("수정된 댓글: nextjs 하위 경로")).toBeVisible();
  await page.unroute("**/api/wiki?*");

  await page.getByRole("button", { name: "검색 해제" }).click();
  await expect(page.locator("[data-wiki-search-results]")).toHaveCount(0);

  await page.goto("/wiki/ai/platform", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await expect(
    page.getByRole("heading", { name: "위키 경로: /ai/platform" }),
  ).toBeVisible();
  await expect(page.getByText("수정된 댓글: nextjs 하위 경로")).toBeVisible();
  await expect(page.getByText("숨김 댓글: 노출되면 안 됨")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "/ai/platform/nextjs", exact: true }),
  ).toBeVisible();
  const detailCommentCard = page
    .locator("[data-wiki-detail-panel] [data-wiki-comment-card]")
    .filter({ hasText: "수정된 댓글: nextjs 하위 경로" })
    .first();
  await expect(
    detailCommentCard.locator("[data-wiki-comment-meta-left]"),
  ).toContainText("/ai/platform/nextjs");
  await expect(
    detailCommentCard.locator("[data-wiki-comment-post-title]"),
  ).toHaveText(seed.title);
  await expect(
    detailCommentCard.locator("[data-wiki-comment-meta-right]"),
  ).toContainText("업데이트:");
  await expect(
    detailCommentCard.locator("[data-wiki-comment-links]"),
  ).not.toContainText(seed.title);
  await expect(
    page.getByRole("link", { name: "블로그 글 보기", exact: true }),
  ).toHaveAttribute("href", `/posts/${created.slug}`);
  await expect(page.getByRole("link", { name: "원문 링크" })).toHaveAttribute(
    "href",
    seed.sourceUrl ?? "",
  );
  const parentToAiLink = page.getByRole("link", {
    name: /상위 경로\s*\(\/wiki\/ai\)/,
  });
  await expect(parentToAiLink).toBeVisible();
  await expect(parentToAiLink).toHaveAttribute("href", "/wiki/ai");
  const breadcrumb = page.getByRole("navigation", { name: "브레드크럼" });
  await expect(breadcrumb.getByRole("link", { name: "위키" })).toHaveAttribute(
    "href",
    "/wiki",
  );
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /wiki/ai/platform has horizontal overflow`,
  );
  await expectNoSeriousA11y(page);
  await expect(page).toHaveScreenshot("wiki-path.png", {
    maxDiffPixelRatio: getWikiDiffThreshold(testInfo.project.name),
  });

  const noLinkSeed: SeededPost = {
    title: "PW-SEED-WIKI-NO-LINKS",
    content: "링크 없음 렌더링 검증용",
    tags: ["wiki", "nolinks"],
    status: "published",
    sourceUrl: null,
    origin: "original",
  };
  const noLinkPost = await insertPostDirect(page.request, noLinkSeed);
  await insertCommentDirect(page.request, {
    postId: noLinkPost.id,
    content: "링크 없는 공개 댓글",
    tagPath: "ai/platform/no-links",
  });

  await page.context().clearCookies();
  await page.goto("/wiki/ai/platform/no-links", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
  await expect(
    page.getByRole("heading", { name: "위키 경로: /ai/platform/no-links" }),
  ).toBeVisible();
  const noLinkCard = page
    .locator("[data-wiki-detail-panel] [data-wiki-comment-card]")
    .filter({ hasText: "링크 없는 공개 댓글" })
    .first();
  await expect(noLinkCard.locator("[data-wiki-comment-post-title]")).toHaveText(
    noLinkSeed.title,
  );
  await expect(noLinkCard.locator("[data-wiki-comment-links]")).toHaveCount(0);
  await expect(
    noLinkCard.getByRole("link", { name: "블로그 글 보기", exact: true }),
  ).toHaveCount(0);
  await expect(
    noLinkCard.getByRole("link", { name: "원문 링크", exact: true }),
  ).toHaveCount(0);
});

test("wiki explorer keeps context with in-place navigation, history, and refresh", async ({
  page,
  request,
}, testInfo) => {
  const seed = 20260224;
  const post = await insertPostDirect(request, {
    title: `PW-WIKI-INPLACE-${seed}`,
    content: "위키 탐색 인플레이스 시나리오",
    tags: ["wiki", "explorer"],
    status: "published",
    sourceUrl: `https://playwright.seed/wiki-inplace/${seed}`,
    origin: "ai",
  });

  await insertCommentDirect(request, {
    postId: post.id,
    content: "루트 ai 댓글",
    tagPath: "ai",
  });
  await insertCommentDirect(request, {
    postId: post.id,
    content: "플랫폼 경로 댓글",
    tagPath: "ai/platform",
  });
  await insertCommentDirect(request, {
    postId: post.id,
    content: "nextjs 하위 경로 댓글",
    tagPath: "ai/platform/nextjs",
  });

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/wiki", { waitUntil: "networkidle" });
  await waitForDocumentTitle(page);
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
  await expect(page).toHaveURL(/\/wiki$/);

  const isMobile = testInfo.project.name === "mobile-360";
  const treePanel = page.locator("[data-wiki-tree-panel]");

  const openTreePanel = async () => {
    if (isMobile) {
      await page.getByRole("button", { name: "트리", exact: true }).click();
    }
    await expect(treePanel).toBeVisible();
  };

  await openTreePanel();
  await treePanel.getByRole("link", { name: "ai", exact: true }).click();
  await expect(page).toHaveURL(/\/wiki\/ai$/);
  await expect(
    page.getByRole("heading", { name: "위키 경로: /ai", exact: true }),
  ).toBeVisible();

  const historyAfterAi = await page.evaluate(() => window.history.length);
  await openTreePanel();
  await treePanel.getByRole("link", { name: "ai", exact: true }).click();
  await expect
    .poll(async () => {
      return await page.evaluate(() => window.history.length);
    })
    .toBe(historyAfterAi);
  await expect(page).toHaveURL(/\/wiki\/ai$/);
  await expect(
    treePanel.getByRole("link", { name: "ai", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    treePanel.getByRole("link", { name: "platform", exact: true }),
  ).toHaveCount(0);

  await openTreePanel();
  await treePanel.getByRole("link", { name: "ai", exact: true }).click();
  await expect
    .poll(async () => {
      return await page.evaluate(() => window.history.length);
    })
    .toBe(historyAfterAi);
  await expect(page).toHaveURL(/\/wiki\/ai$/);
  await expect(
    treePanel.getByRole("link", { name: "platform", exact: true }),
  ).toBeVisible();

  await treePanel.getByRole("link", { name: "platform", exact: true }).click();
  await expect(page).toHaveURL(/\/wiki\/ai\/platform$/);
  await expect(
    page.getByRole("heading", { name: "위키 경로: /ai/platform", exact: true }),
  ).toBeVisible();

  await openTreePanel();
  await expect(
    treePanel.getByRole("link", { name: "nextjs", exact: true }),
  ).toBeVisible();
  const historyAfterPlatform = await page.evaluate(() => window.history.length);
  await treePanel.getByRole("link", { name: "platform", exact: true }).click();
  await expect
    .poll(async () => {
      return await page.evaluate(() => window.history.length);
    })
    .toBe(historyAfterPlatform);
  await expect(page).toHaveURL(/\/wiki\/ai\/platform$/);
  await expect(
    treePanel.getByRole("link", { name: "platform", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const platformHeading = page.getByRole("heading", {
    name: "위키 경로: /ai/platform",
    exact: true,
  });
  if (isMobile) {
    await expect(platformHeading).toHaveCount(0);
  } else {
    await expect(platformHeading).toBeVisible();
  }
  await expect(
    treePanel.getByRole("link", { name: "nextjs", exact: true }),
  ).toHaveCount(0);

  await openTreePanel();
  await treePanel.getByRole("link", { name: "platform", exact: true }).click();
  await expect
    .poll(async () => {
      return await page.evaluate(() => window.history.length);
    })
    .toBe(historyAfterPlatform);
  await expect(page).toHaveURL(/\/wiki\/ai\/platform$/);
  const nextjsTreeLink = treePanel.getByRole("link", {
    name: "nextjs",
    exact: true,
  });
  await expect(nextjsTreeLink).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /wiki/ai/platform retoggle has horizontal overflow`,
  );
  await expectNoSeriousA11y(page);
  await expect(page.locator("main")).toHaveScreenshot(
    "wiki-inplace-retoggle-platform.png",
    {
      maxDiffPixelRatio: getWikiDiffThreshold(testInfo.project.name),
    },
  );

  await page.evaluate(() => {
    document.body.style.minHeight = "5000px";
    window.scrollTo(0, 1300);
  });
  await expect
    .poll(async () => {
      return await page.evaluate(() => window.scrollY);
    })
    .toBeGreaterThan(1200);

  await page.evaluate(() => {
    const nextjsLink = document.querySelector(
      '[data-wiki-tree-panel] a[href="/wiki/ai/platform/nextjs"]',
    );
    if (!(nextjsLink instanceof HTMLAnchorElement)) {
      throw new Error("nextjs link not found");
    }
    nextjsLink.click();
  });
  await expect(page).toHaveURL(/\/wiki\/ai\/platform\/nextjs$/);
  await expect(
    page.getByRole("heading", {
      name: "위키 경로: /ai/platform/nextjs",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("nextjs 하위 경로 댓글")).toBeVisible();
  await expect(page.getByRole("link", { name: "블로그 글 보기" })).toHaveCount(
    0,
  );

  await page.goBack();
  await expect(page).toHaveURL(/\/wiki\/ai\/platform$/);
  await expect(
    page.getByRole("heading", { name: "위키 경로: /ai/platform", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      return await page.evaluate(() => window.scrollY);
    })
    .toBeGreaterThan(900);

  await page.goForward();
  await expect(page).toHaveURL(/\/wiki\/ai\/platform\/nextjs$/);
  await expect(
    page.getByRole("heading", {
      name: "위키 경로: /ai/platform/nextjs",
      exact: true,
    }),
  ).toBeVisible();

  await page.goto("/wiki/ai/platform", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/wiki\/ai\/platform$/);
  await expect(
    page.getByRole("heading", { name: "위키 경로: /ai/platform", exact: true }),
  ).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/wiki\/ai\/platform$/);
  await expect(
    page.getByRole("heading", { name: "위키 경로: /ai/platform", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("플랫폼 경로 댓글")).toBeVisible();

  const breadcrumb = page.getByRole("navigation", { name: "브레드크럼" });
  await expect(breadcrumb.getByRole("link", { name: "위키" })).toBeVisible();
  await expect(
    breadcrumb.getByRole("link", { name: "ai", exact: true }),
  ).toBeVisible();

  const parentToAiLink = page.getByRole("link", {
    name: /상위 경로\s*\(\/wiki\/ai\)/,
  });
  await expect(parentToAiLink).toHaveAttribute("href", "/wiki/ai");
  await parentToAiLink.click();
  await expect(page).toHaveURL(/\/wiki\/ai$/);
  await expect(
    page.getByRole("heading", { name: "위키 경로: /ai", exact: true }),
  ).toBeVisible();

  const parentToRootLink = page.getByRole("link", {
    name: /상위 경로\s*\(\/wiki\)/,
  });
  await expect(parentToRootLink).toHaveAttribute("href", "/wiki");
  await parentToRootLink.click();
  await expect(page).toHaveURL(/\/wiki$/);
  await expect(
    page.getByRole("heading", { name: "위키", level: 1, exact: true }),
  ).toBeVisible();
});
