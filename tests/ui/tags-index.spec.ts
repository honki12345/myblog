import { expect, test } from "@playwright/test";
import { authenticateAdminSession, runCleanupScript } from "./helpers";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.beforeEach(() => {
  runCleanupScript();
});

test("logged out /tags redirects to login with next", async ({ page }) => {
  await page.goto("/tags", { waitUntil: "networkidle" });
  const expected = "/admin/login?next=%2Ftags";
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(expected)}$`));
});

test("admin /tags redirects to /wiki", async ({ page }) => {
  await authenticateAdminSession(page, { nextPath: "/wiki" });
  await page.goto("/tags", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/wiki$/);
  await expect(page.getByRole("heading", { name: "댓글 위키" })).toBeVisible();
});

test("logged out /tags/[tag] redirects to login with next", async ({ page }) => {
  await page.goto("/tags/sample", { waitUntil: "networkidle" });
  const expected = "/admin/login?next=%2Ftags%2Fsample";
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(expected)}$`));
});

test("admin /tags/[tag] is routed to /wiki/[path]", async ({ page }) => {
  await authenticateAdminSession(page, { nextPath: "/wiki" });
  await page.goto("/tags/sample", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/wiki\/sample$/);
});

test("invalid tag path conversion returns 404", async ({ page }) => {
  const response = await page.goto("/tags/invalid_tag", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(404);
});
