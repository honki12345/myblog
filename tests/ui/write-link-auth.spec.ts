import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  assertNoHorizontalPageScroll,
  authenticateAdminSession,
  runCleanupScript,
  waitForDocumentTitle,
} from "./helpers";

function getVisualDiffThreshold(projectName: string): number {
  // CI runner의 폰트 메트릭 차이로 모바일/태블릿 스냅샷에
  // 경미한 줄바꿈/레이아웃 오차가 발생하므로 뷰포트별 허용치로 고정한다.
  if (projectName === "mobile-360") {
    return 0.06;
  }
  if (projectName === "tablet-768") {
    return 0.03;
  }
  // GitHub Actions Ubuntu runner에서 헤더 nav 폰트 메트릭 편차로
  // 요소 너비가 달라질 수 있어 허용치를 높여 flake를 방지한다.
  if (projectName === "desktop-1440") {
    return 0.08;
  }
  return 0.01;
}

test.beforeEach(() => {
  runCleanupScript();
});

test("logged out pages hide admin write entry links", async ({
  page,
}, testInfo) => {
  await page.goto("/wiki", { waitUntil: "networkidle" });

  const nav = page.locator('nav[aria-label="주요 메뉴"]');
  const loginLink = nav.getByRole("link", { name: "로그인" });

  await expect(page.locator('a[href^="/admin/write"]')).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "글 목록" })).toHaveCount(0);
  await expect(nav).toBeVisible();
  await expect(loginLink).toHaveAttribute("href", "/admin/login?next=%2Fwiki");
  await expect(page.locator("main").first()).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /wiki has horizontal overflow (logged out)`,
  );

  const maxDiffPixelRatio = getVisualDiffThreshold(testInfo.project.name);
  await expect(page).toHaveScreenshot("write-link-auth-logged-out.png", {
    fullPage: false,
    maxDiffPixelRatio,
  });

  await waitForDocumentTitle(page);

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
}, testInfo) => {
  await authenticateAdminSession(page, { nextPath: "/" });

  const nav = page.locator('nav[aria-label="주요 메뉴"]');
  const writeLink = nav.getByRole("link", { name: "글쓰기" });

  await expect(writeLink).toBeVisible({ timeout: 10_000 });
  await expect(writeLink).toHaveAttribute("href", "/admin/write");
  await expect(page.locator("main").first()).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] / has horizontal overflow (admin)`,
  );

  const maxDiffPixelRatio = getVisualDiffThreshold(testInfo.project.name);
  await expect(page).toHaveScreenshot("write-link-auth-logged-in.png", {
    fullPage: false,
    maxDiffPixelRatio,
  });

  await waitForDocumentTitle(page);

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
