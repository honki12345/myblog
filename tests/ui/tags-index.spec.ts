import { expect, test } from "@playwright/test";
import {
  authenticateAdminSession,
  insertPostDirect,
  runCleanupScript,
  seedVisualPosts,
} from "./helpers";

test.describe("tags index", () => {
  test.beforeEach(async ({ request }) => {
    await seedVisualPosts(request);
  });

  test("navigation tag link routes to /tags", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page
      .getByRole("navigation", { name: "주요 메뉴" })
      .getByRole("link", { name: "태그" })
      .click();

    await expect(page).toHaveURL(/\/tags$/);
    await expect(page.getByRole("heading", { name: "태그" })).toBeVisible();
  });

  test("clicking a tag routes to /tags/[tag]", async ({ page }) => {
    await page.goto("/tags", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /#sample/ }).click();

    await expect(page).toHaveURL(/\/tags\/sample$/);
    await expect(
      page.getByRole("heading", { name: "태그: sample" }),
    ).toBeVisible();
  });

  test("only published posts are counted (draft-only tags are hidden)", async ({
    page,
    request,
  }) => {
    await insertPostDirect(request, {
      title: "PW-SEED-드래프트 전용 태그 글",
      content: "draft only tags should not be listed",
      tags: ["draft-only"],
      status: "draft",
      sourceUrl: "https://playwright.seed/draft-only-tags",
    });

    await page.goto("/tags", { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: /#draft-only/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: /#sample/ })).toContainText(
      "3개",
    );
  });

  test("admin can see draft-only tags", async ({ page, request }) => {
    await insertPostDirect(request, {
      title: "PW-SEED-드래프트 전용 태그 글",
      content: "draft only tags should be listed for admin",
      tags: ["draft-only"],
      status: "draft",
      sourceUrl: "https://playwright.seed/draft-only-tags",
    });

    await authenticateAdminSession(page, { nextPath: "/tags" });
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "태그" })).toBeVisible();
    await expect(page.getByRole("link", { name: /#draft-only/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /#draft-only/ })).toContainText(
      "1개",
    );
  });
});

test("tags index renders empty state when there are no published tags", async ({
  page,
  request,
}) => {
  runCleanupScript();
  await insertPostDirect(request, {
    title: "PW-SEED-드래프트만 있는 케이스",
    content: "draft only",
    tags: ["draft-only"],
    status: "draft",
    sourceUrl: "https://playwright.seed/tags-empty-state",
  });

  await page.goto("/tags", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "태그" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "빈 목록" })).toBeVisible();
  await expect(
    page.getByText("공개 글에 연결된 태그가 없습니다."),
  ).toBeVisible();
});
