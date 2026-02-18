import { expect, test } from "@playwright/test";
import { seedVisualPosts, waitForDocumentTitle } from "./helpers";

test("home title link scrolls to top when already on /", async ({
  page,
  request,
}) => {
  await seedVisualPosts(request);

  await page.goto("/", { waitUntil: "networkidle" });
  await waitForDocumentTitle(page);
  await expect(
    page.getByRole("heading", { name: "홈", exact: true }),
  ).toBeVisible();

  const homeLinks = page.locator('header a[href="/"]');
  await expect(homeLinks).toHaveCount(1);

  const titleLink = homeLinks.first();
  await expect(titleLink).toHaveAttribute("aria-label", "홈 (honki12345 블로그)");
  await expect(titleLink).toHaveAttribute("aria-current", "page");
  await expect(titleLink).toHaveClass(/focus-visible:ring-2/);

  await page.keyboard.press("Tab");
  await expect(titleLink).toBeFocused();

  await page.evaluate(() => {
    window.scrollTo(0, Math.max(document.body.scrollHeight, 2000));
  });

  await expect
    .poll(async () => {
      return await page.evaluate(() => window.scrollY);
    })
    .toBeGreaterThan(0);

  await titleLink.click();

  await expect
    .poll(async () => {
      return await page.evaluate(() => window.scrollY);
    })
    .toBe(0);
});
