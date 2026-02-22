import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  authenticateAdminSession,
  insertPostDirect,
  resolveApiKey,
  runCleanupScript,
} from "./helpers";

async function triggerRevalidation(
  request: import("@playwright/test").APIRequestContext,
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

function getVisualDiffThreshold(projectName: string): number {
  if (projectName === "mobile-360") {
    return 0.08;
  }
  if (projectName === "tablet-768") {
    return 0.06;
  }
  if (projectName === "desktop-1440") {
    return 0.02;
  }
  return 0.01;
}

const DISABLE_ANIMATION_STYLE = `
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }

  [data-post-date] {
    visibility: hidden !important;
  }
`;

test.beforeEach(() => {
  runCleanupScript();
});

test("admin: typeahead shows suggestions and click navigates to post detail", async ({
  page,
  request,
}) => {
  const keyword = "needle";
  const published = {
    title: "PW-SUGGEST-PUBLISHED-CONTENT-MATCH",
    content: `this post contains ${keyword} in its body`,
    tags: ["pw", "suggest"],
    status: "published" as const,
    sourceUrl: "https://playwright.seed/suggest/published",
  };

  const created = await insertPostDirect(request, published);
  await triggerRevalidation(request, { ...created, ...published });

  await authenticateAdminSession(page, { nextPath: "/posts" });
  await page.waitForLoadState("networkidle");
  const combobox = page.getByRole("combobox", { name: "검색" });
  await combobox.click();
  await combobox.fill(keyword);

  const listbox = page.getByRole("listbox", { name: "검색 추천" });
  const suggestion = listbox.getByRole("option", { name: published.title });
  await expect(suggestion).toBeVisible();

  await suggestion.click();
  await expect(page).toHaveURL(new RegExp(`/posts/${created.slug}$`));
  await expect(
    page.getByRole("heading", { name: published.title }),
  ).toBeVisible();
});

test("admin: last token prefix matches partial input and FTS syntax-like input stays silent", async ({
  page,
  request,
}) => {
  const published = {
    title: "PW-SUGGEST-KUBERNETES",
    content: "kubernetes content",
    tags: ["pw", "suggest"],
    status: "published" as const,
    sourceUrl: "https://playwright.seed/suggest/kubernetes",
  };

  await insertPostDirect(request, published);

  await authenticateAdminSession(page, { nextPath: "/posts" });
  await page.waitForLoadState("networkidle");
  const combobox = page.getByRole("combobox", { name: "검색" });
  await combobox.click();
  await combobox.fill("kube");

  const listbox = page.getByRole("listbox", { name: "검색 추천" });
  await expect(
    listbox.getByRole("option", { name: published.title }),
  ).toBeVisible();

  await combobox.fill(`"'[]()*+`);
  await expect(listbox).toBeHidden();
  await expect(page.getByText("추천을 불러오지 못했습니다")).toHaveCount(0);
});

test("admin: suggestions are capped at 8 items", async ({ page, request }) => {
  const keyword = "manykey";
  const seeds = Array.from({ length: 9 }, (_, index) => ({
    title: `PW-SUGGEST-MANY-${index + 1}`,
    content: `this post contains ${keyword}`,
    tags: ["pw", "suggest"],
    status: "published" as const,
    sourceUrl: `https://playwright.seed/suggest/many/${index + 1}`,
  }));

  for (const seed of seeds) {
    await insertPostDirect(request, seed);
  }

  await authenticateAdminSession(page, { nextPath: "/posts" });
  await page.waitForLoadState("networkidle");
  const combobox = page.getByRole("combobox", { name: "검색" });
  await combobox.click();
  await combobox.fill(keyword);

  const listbox = page.getByRole("listbox", { name: "검색 추천" });
  await expect(listbox).toBeVisible();
  await expect(
    listbox.locator('[role="option"]:not([aria-disabled="true"])'),
  ).toHaveCount(8);
});

test("admin: keyboard controls (down/enter/esc) work and blur closes dropdown", async ({
  page,
  request,
}) => {
  const keyword = "keynav";
  const seeds = [
    {
      title: "PW-SUGGEST-KEYNAV-A",
      content: `this post contains ${keyword}`,
      tags: ["pw", "suggest"],
      status: "published" as const,
      sourceUrl: "https://playwright.seed/suggest/keynav/a",
    },
    {
      title: "PW-SUGGEST-KEYNAV-B",
      content: `this post also contains ${keyword}`,
      tags: ["pw", "suggest"],
      status: "published" as const,
      sourceUrl: "https://playwright.seed/suggest/keynav/b",
    },
  ];

  const created = [];
  for (const seed of seeds) {
    created.push(await insertPostDirect(request, seed));
  }

  await authenticateAdminSession(page, { nextPath: "/posts" });
  await page.waitForLoadState("networkidle");
  const combobox = page.getByRole("combobox", { name: "검색" });
  await combobox.click();
  await combobox.fill(keyword);

  const listbox = page.getByRole("listbox", { name: "검색 추천" });
  const firstOption = listbox
    .locator('[role="option"]:not([aria-disabled="true"])')
    .first();
  await expect(firstOption).toBeVisible();
  const expectedTitle = (await firstOption.innerText()).trim();
  expect(expectedTitle).toBeTruthy();

  await combobox.press("ArrowDown");
  await combobox.press("Enter");
  await expect(
    page.getByRole("heading", { name: expectedTitle }),
  ).toBeVisible();

  await page.goto("/posts", { waitUntil: "networkidle" });
  await combobox.click();
  await combobox.fill(keyword);
  await expect(listbox).toBeVisible();
  await expect(
    listbox.locator('[role="option"]:not([aria-disabled="true"])'),
  ).toHaveCount(2);

  await combobox.press("Escape");
  await expect(listbox).toBeHidden();

  await combobox.press("ArrowDown");
  await expect(listbox).toBeVisible();
  await expect(
    listbox.locator('[role="option"]:not([aria-disabled="true"])'),
  ).toHaveCount(2);
  await page.getByLabel("태그").click();
  await expect(listbox).toBeHidden();

  expect(created.length).toBe(2);
});

test("admin: draft+published are suggested and draft selection goes to editor", async ({
  page,
  request,
}) => {
  const keyword = "adminkey";
  const published = {
    title: `PW-SUGGEST-ADMIN-PUBLISHED ${keyword}`,
    content: "published content",
    tags: ["pw", "suggest"],
    status: "published" as const,
    sourceUrl: "https://playwright.seed/suggest/admin/published",
  };
  const draft = {
    title: `PW-SUGGEST-ADMIN-DRAFT ${keyword}`,
    content: "draft content",
    tags: ["pw", "suggest"],
    status: "draft" as const,
    sourceUrl: "https://playwright.seed/suggest/admin/draft",
  };

  const publishedPost = await insertPostDirect(request, published);
  const draftPost = await insertPostDirect(request, draft);

  await authenticateAdminSession(page, { nextPath: "/posts" });
  await page.waitForLoadState("networkidle");

  const combobox = page.getByRole("combobox", { name: "검색" });
  await combobox.click();
  await combobox.fill(keyword);

  const listbox = page.getByRole("listbox", { name: "검색 추천" });
  await expect(listbox).toBeVisible();
  await expect(
    listbox.getByRole("option", { name: published.title }),
  ).toBeVisible();

  const draftLink = listbox.getByRole("option", {
    name: new RegExp(draft.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  });
  await expect(draftLink).toBeVisible();

  await draftLink.click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/write\\?id=${draftPost.id}$`),
  );
  await expect(
    page.getByRole("heading", { name: `글 수정 #${draftPost.id}` }),
  ).toBeVisible();

  expect(publishedPost.slug).toBeTruthy();
});

test.describe("JS OFF", () => {
  test.use({ javaScriptEnabled: false });

  test("non-admin GET /posts query redirects to login without JS", async ({
    page,
  }) => {
    const keyword = "nojsneedle";
    await page.goto(`/posts?q=${keyword}`, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(
      new RegExp(`/admin/login\\?next=%2Fposts%3Fq%3D${keyword}$`),
    );
  });
});

test("a11y+snapshot: posts suggest dropdown open state", async ({
  page,
  request,
}, testInfo) => {
  const keyword = "snapkey";
  const seeds = [
    {
      title: `PW-SUGGEST-SNAPSHOT-A ${keyword}`,
      content: "snapshot A content",
      tags: ["pw", "suggest"],
      status: "published" as const,
      sourceUrl: "https://playwright.seed/suggest/snapshot/a",
    },
    {
      title: `PW-SUGGEST-SNAPSHOT-B ${keyword}`,
      content: "snapshot B content",
      tags: ["pw", "suggest"],
      status: "published" as const,
      sourceUrl: "https://playwright.seed/suggest/snapshot/b",
    },
  ];

  for (const seed of seeds) {
    await insertPostDirect(request, seed);
  }

  await authenticateAdminSession(page, { nextPath: "/posts" });
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  const combobox = page.getByRole("combobox", { name: "검색" });
  await combobox.click();
  await combobox.fill(keyword);

  const listbox = page.getByRole("listbox", { name: "검색 추천" });
  await expect(listbox).toBeVisible();
  await expect(
    listbox.locator('[role="option"]:not([aria-disabled="true"])'),
  ).toHaveCount(2);

  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });
  expect(
    blockingViolations,
    "/posts suggest open has serious/critical a11y violations",
  ).toEqual([]);

  const maxDiffPixelRatio = getVisualDiffThreshold(testInfo.project.name);
  await expect(page).toHaveScreenshot("posts-suggest-open.png", {
    maxDiffPixelRatio,
  });
});
