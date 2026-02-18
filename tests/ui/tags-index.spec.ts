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
    await expect(
      page.getByRole("heading", { name: "태그", exact: true }),
    ).toBeVisible();
  });

  test("clicking a top tag routes to /tags/[tag]", async ({ page }) => {
    await page.goto("/tags", { waitUntil: "networkidle" });
    await page.locator("[data-tags-top]").getByRole("link", { name: /#sample/ }).click();

    await expect(page).toHaveURL(/\/tags\/sample$/);
    await expect(
      page.getByRole("heading", { name: "태그: sample" }),
    ).toBeVisible();
  });

  test("drawer shows preview chips by default and expands to full list", async ({
    page,
    request,
  }) => {
    for (let index = 1; index <= 12; index += 1) {
      await insertPostDirect(request, {
        title: `PW-SEED-태그 미리보기 확장 ${index}`,
        content: `extra tag ${index}`,
        tags: [`extra-${index}`],
        status: "published",
        sourceUrl: `https://playwright.seed/extra-tag-${index}`,
      });
    }

    await page.goto("/tags", { waitUntil: "networkidle" });

    const drawer = page.locator("[data-tags-drawer]");
    const preview = page.locator("[data-tags-drawer-preview]");
    const grid = page.locator("[data-tags-drawer-grid]");

    await expect(preview).toBeVisible();
    await expect(grid).not.toBeVisible();
    await expect(preview.locator("a")).toHaveCount(10);
    await expect(preview).toContainText("+6개");

    await drawer.locator("summary").click();
    await expect(grid).toBeVisible();
    await expect(grid.locator("a")).toHaveCount(16);
  });

  test("search filters tags, opens the drawer, and hides top tags", async ({
    page,
  }) => {
    await page.goto("/tags", { waitUntil: "networkidle" });
    await page.getByLabel("태그 검색").fill("sa");
    await page.getByRole("button", { name: "검색" }).click();
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/\/tags\?q=sa$/);
    await expect(page.locator("[data-tags-top]")).toHaveCount(0);

    const grid = page.locator("[data-tags-drawer-grid]");
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("link", { name: /#sample/ })).toBeVisible();
    await expect(grid.getByRole("link")).toHaveCount(1);
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
    await page.locator("[data-tags-drawer] summary").click();

    const grid = page.locator("[data-tags-drawer-grid]");
    await expect(grid.getByRole("link", { name: /#draft-only/ })).toHaveCount(0);
    await expect(grid.getByRole("link", { name: /#sample/ })).toContainText(
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

    await expect(
      page.getByRole("heading", { name: "태그", exact: true }),
    ).toBeVisible();
    await page.locator("[data-tags-drawer] summary").click();

    const grid = page.locator("[data-tags-drawer-grid]");
    await expect(grid.getByRole("link", { name: /#draft-only/ })).toBeVisible();
    await expect(grid.getByRole("link", { name: /#draft-only/ })).toContainText(
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
