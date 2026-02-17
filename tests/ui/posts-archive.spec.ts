import { expect, test, type APIRequestContext } from "@playwright/test";
import { insertPostDirect, resolveApiKey, runCleanupScript } from "./helpers";

async function triggerRevalidation(
  request: APIRequestContext,
  post: {
    id: number;
    title: string;
    content: string;
    tags: string[];
    status: "draft" | "published";
  },
): Promise<void> {
  const apiKey = resolveApiKey();
  const response = await request.patch(`/api/posts/${post.id}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    data: {
      title: post.title,
      content: post.content,
      status: post.status,
      tags: post.tags,
    },
  });

  expect(response.ok()).toBeTruthy();
}

test.beforeEach(() => {
  runCleanupScript();
});

test("public: type filter matches posts.origin", async ({ page, request }) => {
  const originalA = {
    title: `PLAYWRIGHT-ARCHIVE-ORIGINAL-A-${Date.now()}`,
    content: "archive original A",
    tags: ["archive-type"],
    status: "published" as const,
    sourceUrl: null,
    origin: "original" as const,
  };
  const originalB = {
    title: `PLAYWRIGHT-ARCHIVE-ORIGINAL-B-${Date.now()}`,
    content: "archive original B",
    tags: ["archive-type"],
    status: "published" as const,
    sourceUrl: null,
    origin: "original" as const,
  };
  const aiA = {
    title: `PLAYWRIGHT-ARCHIVE-AI-A-${Date.now()}`,
    content: "archive ai A",
    tags: ["archive-type"],
    status: "published" as const,
    sourceUrl: `https://playwright.seed/archive/ai/a/${Date.now()}`,
  };
  const aiB = {
    title: `PLAYWRIGHT-ARCHIVE-AI-B-${Date.now()}`,
    content: "archive ai B",
    tags: ["archive-type"],
    status: "published" as const,
    sourceUrl: `https://playwright.seed/archive/ai/b/${Date.now()}`,
  };

  const createdOriginalA = await insertPostDirect(request, originalA);
  const createdOriginalB = await insertPostDirect(request, originalB);
  const createdAiA = await insertPostDirect(request, aiA);
  const createdAiB = await insertPostDirect(request, aiB);

  await triggerRevalidation(request, { ...createdOriginalA, ...originalA });
  await triggerRevalidation(request, { ...createdOriginalB, ...originalB });
  await triggerRevalidation(request, { ...createdAiA, ...aiA });
  await triggerRevalidation(request, { ...createdAiB, ...aiB });

  await page.goto("/posts?type=original&per_page=50", {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("link", { name: originalA.title })).toBeVisible();
  await expect(page.getByRole("link", { name: originalB.title })).toBeVisible();
  await expect(page.getByRole("link", { name: aiA.title })).toHaveCount(0);
  await expect(page.getByRole("link", { name: aiB.title })).toHaveCount(0);

  await page.goto("/posts?type=ai&per_page=50", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: aiA.title })).toBeVisible();
  await expect(page.getByRole("link", { name: aiB.title })).toBeVisible();
  await expect(page.getByRole("link", { name: originalA.title })).toHaveCount(0);
  await expect(page.getByRole("link", { name: originalB.title })).toHaveCount(0);
});

test("public: pagination preserves type/q/tag/per_page (+ type invalid fallback)", async ({
  page,
  request,
}) => {
  const tag = "combo-tag";
  const keyword = "combokeyword";

  const seeds = Array.from({ length: 12 }, (_, index) => ({
    title: `PLAYWRIGHT-ARCHIVE-COMBO-${index + 1}-${Date.now()}`,
    content: `post content ${keyword} ${index + 1}`,
    tags: [tag],
    status: "published" as const,
    sourceUrl: `https://playwright.seed/archive/combo/${Date.now()}/${index + 1}`,
  }));

  let lastCreated: { id: number; slug: string } | null = null;
  for (const seed of seeds) {
    lastCreated = await insertPostDirect(request, seed);
  }

  expect(lastCreated).not.toBeNull();
  await triggerRevalidation(request, {
    id: lastCreated?.id ?? 0,
    title: seeds[seeds.length - 1].title,
    content: seeds[seeds.length - 1].content,
    tags: seeds[seeds.length - 1].tags,
    status: seeds[seeds.length - 1].status,
  });

  await page.goto(
    `/posts?type=ai&tag=${encodeURIComponent(tag)}&q=${encodeURIComponent(
      keyword,
    )}&per_page=5`,
    { waitUntil: "networkidle" },
  );
  const page2Link = page.getByRole("link", { name: "2", exact: true });
  await expect(page2Link).toBeVisible();
  await page2Link.click();
  await expect(page).toHaveURL(/\btype=ai\b/);
  await expect(page).toHaveURL(new RegExp(`\\btag=${tag}\\b`));
  await expect(page).toHaveURL(new RegExp(`\\bq=${keyword}\\b`));
  await expect(page).toHaveURL(/\bper_page=5\b/);
  await expect(page).toHaveURL(/\bpage=2\b/);

  await page.goto(
    `/posts?type=invalid&tag=${encodeURIComponent(tag)}&q=${encodeURIComponent(
      keyword,
    )}&per_page=5`,
    { waitUntil: "networkidle" },
  );
  await page.getByRole("link", { name: "2", exact: true }).click();
  await expect(page).not.toHaveURL(/\btype=invalid\b/);
  await expect(page).not.toHaveURL(/\btype=original\b/);
  await expect(page).not.toHaveURL(/\btype=ai\b/);
  await expect(page).toHaveURL(new RegExp(`\\btag=${tag}\\b`));
  await expect(page).toHaveURL(new RegExp(`\\bq=${keyword}\\b`));
  await expect(page).toHaveURL(/\bper_page=5\b/);
  await expect(page).toHaveURL(/\bpage=2\b/);
});

test("public: q with special characters does not crash (no 500)", async ({
  page,
}) => {
  const response = await page.goto(`/posts?q=%22%27%5B%5D%28%29%2A%2B`, {
    waitUntil: "networkidle",
  });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "글 목록" })).toBeVisible();
  await expect(
    page.getByText(/검색어를 해석할 수 없습니다/),
  ).toBeVisible();
});

test("public: type/q/tag combination returns expected results", async ({
  page,
  request,
}) => {
  const tag = "searchtag";
  const keyword = "needle";

  const originalMatch = {
    title: `PLAYWRIGHT-ARCHIVE-SEARCH-ORIG-${Date.now()}`,
    content: `this post contains ${keyword}`,
    tags: [tag],
    status: "published" as const,
    sourceUrl: null,
    origin: "original" as const,
  };
  const aiMatch = {
    title: `PLAYWRIGHT-ARCHIVE-SEARCH-AI-${Date.now()}`,
    content: `this post also contains ${keyword}`,
    tags: [tag],
    status: "published" as const,
    sourceUrl: `https://playwright.seed/archive/search/${Date.now()}`,
  };
  const originalMiss = {
    title: `PLAYWRIGHT-ARCHIVE-SEARCH-MISS-${Date.now()}`,
    content: "this post should not match",
    tags: [tag],
    status: "published" as const,
    sourceUrl: null,
    origin: "original" as const,
  };

  const createdOriginalMatch = await insertPostDirect(request, originalMatch);
  const createdAiMatch = await insertPostDirect(request, aiMatch);
  const createdOriginalMiss = await insertPostDirect(request, originalMiss);

  await triggerRevalidation(request, {
    ...createdOriginalMatch,
    ...originalMatch,
  });
  await triggerRevalidation(request, { ...createdAiMatch, ...aiMatch });
  await triggerRevalidation(request, {
    ...createdOriginalMiss,
    ...originalMiss,
  });

  await page.goto(
    `/posts?type=original&tag=${encodeURIComponent(tag)}&q=${encodeURIComponent(
      keyword,
    )}&per_page=50`,
    { waitUntil: "networkidle" },
  );

  await expect(
    page.getByRole("link", { name: originalMatch.title }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: aiMatch.title })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: originalMiss.title }),
  ).toHaveCount(0);
});
