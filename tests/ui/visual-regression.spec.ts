import { expect, test } from "@playwright/test";
import { authenticateAdminSession, seedVisualPosts } from "./helpers";

const routes = [
  { name: "home", path: "/" },
  { name: "posts", path: "/posts" },
  { name: "admin-write", path: "/admin/write" },
  { name: "tag-sample", path: "/tags/sample" },
] as const;

function getVisualDiffThreshold(projectName: string): number {
  // CI runner의 폰트 메트릭 차이로 모바일/태블릿 스냅샷에
  // 경미한 줄바꿈/레이아웃 오차가 발생하므로 뷰포트별 허용치로 고정한다.
  if (projectName === "mobile-360") {
    return 0.06;
  }
  if (projectName === "tablet-768") {
    return 0.03;
  }
  // GitHub Actions runner에서도 데스크톱 폰트 렌더링 차이로 미세한 diff가 발생할 수 있다.
  return 0.02;
}

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
    if (route.name === "admin-write") {
      await authenticateAdminSession(page, { nextPath: "/admin/write" });
      await page.waitForLoadState("networkidle");
    } else {
      await page.goto(route.path, { waitUntil: "networkidle" });
    }

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

    if (route.name === "admin-write") {
      await expect(
        page.getByRole("heading", { name: "새 글 작성" }),
      ).toBeVisible();
      await expect(page.getByLabel("제목")).toBeVisible();
    }

    if (route.name === "tag-sample") {
      await expect(
        page.getByRole("heading", { name: "태그: sample" }),
      ).toBeVisible();
      await expect(page.locator("article").first()).toBeVisible();
    }

    const maxDiffPixelRatio = getVisualDiffThreshold(testInfo.project.name);
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: false,
      maxDiffPixelRatio,
    });
  });
}
