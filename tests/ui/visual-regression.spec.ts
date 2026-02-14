import { expect, test } from "@playwright/test";

const routes = [
  { name: "home", path: "/" },
  { name: "posts", path: "/posts" },
  { name: "write", path: "/write" },
  { name: "tag-sample", path: "/tags/sample" },
] as const;

const DISABLE_ANIMATION_STYLE = `
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

for (const route of routes) {
  test(`visual snapshot: ${route.name}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(route.path, { waitUntil: "networkidle" });

    await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
    await expect(page.locator("main").first()).toBeVisible();

    const maxDiffPixelRatio =
      testInfo.project.name === "mobile-360" ? 0.04 : 0.01;
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: true,
      maxDiffPixelRatio,
    });
  });
}
