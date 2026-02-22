import { expect, test } from "@playwright/test";
import {
  authenticateAdminSession,
  insertPostDirect,
  resolveApiKey,
  runCleanupScript,
} from "./helpers";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

test.beforeEach(() => {
  runCleanupScript();
});

test("non-admin wiki home is public and protected routes redirect to login", async ({
  page,
  request,
}) => {
  const seed = Date.now();
  const publishedTitle = `PW-DRAFT-VIS-PUBLISHED-${seed}`;
  const draftTitle = `PW-DRAFT-VIS-DRAFT-${seed}`;

  const published = {
    title: publishedTitle,
    content: "published content",
    tags: ["pw", "draft-vis"],
    status: "published" as const,
    sourceUrl: `https://playwright.seed/draft-vis/published/${seed}`,
  };
  const draft = {
    title: draftTitle,
    content: "draft content",
    tags: ["pw", "draft-vis"],
    status: "draft" as const,
    sourceUrl: `https://playwright.seed/draft-vis/draft/${seed}`,
  };

  const publishedPost = await insertPostDirect(request, published);
  const draftPost = await insertPostDirect(request, draft);

  await triggerRevalidation(request, { ...publishedPost, ...published });
  await triggerRevalidation(request, { ...draftPost, ...draft });

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "위키", level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "관리자 빠른 이동" }),
  ).toHaveCount(0);

  const protectedPaths = [
    "/posts?per_page=50",
    `/posts/${publishedPost.slug}`,
    "/tags",
    "/tags/draft-vis",
  ] as const;

  for (const path of protectedPaths) {
    await page.goto(path, { waitUntil: "networkidle" });
    const expected = `/admin/login?next=${encodeURIComponent(path)}`;
    await expect(page).toHaveURL(new RegExp(`${escapeRegex(expected)}$`));
  }

  const postsApi = await request.get("/api/posts");
  expect(postsApi.status()).toBe(401);

  const suggestApi = await request.get("/api/posts/suggest?q=draft");
  expect(suggestApi.status()).toBe(401);
});

test("admin can access protected pages and draft data", async ({
  page,
  request,
}) => {
  const seed = Date.now();
  const publishedTitle = `PW-DRAFT-VIS-PUBLISHED-${seed}`;
  const draftTitle = `PW-DRAFT-VIS-DRAFT-${seed}`;

  const published = {
    title: publishedTitle,
    content: "published content",
    tags: ["pw", "draft-vis"],
    status: "published" as const,
    sourceUrl: `https://playwright.seed/draft-vis/published/${seed}`,
  };
  const draft = {
    title: draftTitle,
    content: "draft content",
    tags: ["pw", "draft-vis"],
    status: "draft" as const,
    sourceUrl: `https://playwright.seed/draft-vis/draft/${seed}`,
  };

  const publishedPost = await insertPostDirect(request, published);
  const draftPost = await insertPostDirect(request, draft);

  await triggerRevalidation(request, { ...publishedPost, ...published });
  await triggerRevalidation(request, { ...draftPost, ...draft });

  await authenticateAdminSession(page, { nextPath: "/posts?per_page=50" });
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("link", { name: publishedTitle })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("link", { name: draftTitle })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("link", { name: draftTitle }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/write\\?id=${draftPost.id}$`),
  );
  await expect(
    page.getByRole("heading", { name: `글 수정 #${draftPost.id}` }),
  ).toBeVisible();

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "위키", level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "관리자 빠른 이동" }),
  ).toBeVisible();

  await page.goto("/tags", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/wiki$/);

  await page.goto("/tags/draft-vis", {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(/\/wiki\/draft-vis$/);
});
