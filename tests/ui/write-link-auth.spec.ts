import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { authenticateAdminSession, runCleanupScript } from "./helpers";

test.beforeEach(() => {
  runCleanupScript();
});

test("logged out pages hide admin write entry links", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const nav = page.locator('nav[aria-label="주요 메뉴"]');
  const loginLink = nav.getByRole("link", { name: "로그인" });

  await expect(page.locator('a[href^="/admin/write"]')).toHaveCount(0);
  await expect(nav).toBeVisible();
  await expect(loginLink).toHaveAttribute("href", "/admin/login?next=%2F");
  await expect(nav).toHaveScreenshot("write-link-auth-logged-out-nav.png");

  const accessibility = await new AxeBuilder({ page })
    .include('nav[aria-label="주요 메뉴"]')
    .analyze();
  const blockingViolations = accessibility.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });
  expect(
    blockingViolations,
    "header nav has serious/critical accessibility violations (logged out)",
  ).toEqual([]);
});

test("admin session shows write link in header navigation", async ({
  page,
}) => {
  await authenticateAdminSession(page, { nextPath: "/" });

  const nav = page.locator('nav[aria-label="주요 메뉴"]');
  const writeLink = nav.getByRole("link", { name: "글쓰기" });

  await expect(writeLink).toBeVisible({ timeout: 10_000 });
  await expect(writeLink).toHaveAttribute("href", "/admin/write");
  await expect(nav).toHaveScreenshot("write-link-auth-logged-in-nav.png");

  const accessibility = await new AxeBuilder({ page })
    .include('nav[aria-label="주요 메뉴"]')
    .analyze();
  const blockingViolations = accessibility.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });
  expect(
    blockingViolations,
    "header nav has serious/critical accessibility violations (admin)",
  ).toEqual([]);
});
