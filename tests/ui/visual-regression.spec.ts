import { expect, test } from "@playwright/test";
import { seedVisualPosts } from "./helpers";

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

  [data-post-date] {
    visibility: hidden !important;
  }
`;

test.beforeEach(async ({ request }) => {
  await seedVisualPosts(request);
});

for (const route of routes) {
  test(`visual snapshot: ${route.name}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(route.path, { waitUntil: "networkidle" });

    await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
    await expect(page.locator("main").first()).toBeVisible();

    if (route.name === "home") {
      await expect(
        page.getByRole("heading", { name: "최신 공개 글" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "글 목록" })).toBeVisible();
    }

    if (route.name === "posts") {
      await expect(
        page.getByRole("heading", { name: "글 목록" }),
      ).toBeVisible();
      await expect(page.locator("article").first()).toBeVisible();
    }

    if (route.name === "write") {
      await expect(
        page.getByRole("heading", { name: "글쓰기 인증" }),
      ).toBeVisible();
      await expect(page.getByLabel("API Key")).toBeVisible();
    }

    if (route.name === "tag-sample") {
      await expect(
        page.getByRole("heading", { name: "태그: sample" }),
      ).toBeVisible();
      await expect(page.locator("article").first()).toBeVisible();
    }

    const maxDiffPixelRatio =
      testInfo.project.name === "mobile-360" ? 0.04 : 0.01;
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: true,
      maxDiffPixelRatio,
    });
  });
}
