import { expect, test } from "@playwright/test";
import {
  authenticateAdminSession,
  seedVisualPosts,
  waitForDocumentTitle,
} from "./helpers";

test("home title link scrolls to top when already on /", async ({
  page,
  request,
}) => {
  await seedVisualPosts(request);

  await authenticateAdminSession(page, { nextPath: "/" });
  await page.waitForLoadState("networkidle");
  await waitForDocumentTitle(page);
  await expect(
    page.getByRole("heading", { name: "위키", level: 1, exact: true }),
  ).toBeVisible();

  const homeLinks = page.locator('header a[href="/"]');
  await expect(homeLinks).toHaveCount(1);

  const titleLink = homeLinks.first();
  await expect(titleLink).toHaveAttribute(
    "aria-label",
    "홈 (honki12345 블로그)",
  );
  await expect(titleLink).toHaveAttribute("aria-current", "page");
  await expect(titleLink).toHaveClass(/focus-visible:ring-2/);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const isFocused = await titleLink.evaluate((node) => {
      return node === document.activeElement;
    });
    if (isFocused) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(titleLink).toBeFocused();

  await page.evaluate(() => {
    document.body.style.minHeight = "4000px";
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
