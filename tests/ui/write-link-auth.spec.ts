import { expect, test } from "@playwright/test";
import { authenticateAdminSession, runCleanupScript } from "./helpers";

test.beforeEach(() => {
  runCleanupScript();
});

test("logged out pages hide admin write entry links", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.locator('a[href^="/admin/write"]')).toHaveCount(0);
  await expect(page.locator('nav[aria-label="주요 메뉴"]')).toBeVisible();
});

test("admin session shows write link in header navigation", async ({ page }) => {
  await authenticateAdminSession(page, { nextPath: "/" });

  const nav = page.locator('nav[aria-label="주요 메뉴"]');
  const writeLink = nav.getByRole("link", { name: "글쓰기" });

  await expect(writeLink).toBeVisible({ timeout: 10_000 });
  await expect(writeLink).toHaveAttribute("href", "/admin/write");
});

