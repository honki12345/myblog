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

test.beforeEach(() => {
  runCleanupScript();
});

test("public posts list hides draft", async ({ page, request }) => {
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

  const apiResponse = await request.get("/api/posts");
  expect(apiResponse.ok()).toBeTruthy();
  const apiPayload = (await apiResponse.json()) as {
    items?: Array<{ id: number }>;
  };
  const apiIds = Array.isArray(apiPayload.items)
    ? apiPayload.items.map((item) => item.id)
    : [];
  expect(apiIds).toContain(publishedPost.id);
  expect(apiIds).not.toContain(draftPost.id);

  await page.goto("/posts?per_page=50", { waitUntil: "networkidle" });

  await expect(page.getByRole("link", { name: publishedTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: draftTitle })).toHaveCount(0);

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: publishedTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: draftTitle })).toHaveCount(0);

  await page.goto("/tags/draft-vis", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: publishedTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: draftTitle })).toHaveCount(0);
});

test("admin posts list shows draft and draft link goes to editor", async ({
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

  await page.goto("/posts?per_page=50", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: publishedTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/posts/${publishedPost.slug}$`));
  await expect(
    page.getByRole("heading", { name: publishedTitle }),
  ).toBeVisible();

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: draftTitle })).toBeVisible();

  await page.goto("/tags/draft-vis", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: draftTitle })).toBeVisible();
});
