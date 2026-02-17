import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const DISABLE_ANIMATION_STYLE = `
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

function getRedirectDiffThreshold(projectName: string): number {
  // CI 러너의 폰트 메트릭 차이로 로그인 화면에서 줄바꿈 오차가 발생한다.
  if (projectName === "mobile-360") {
    return 0.05;
  }
  if (projectName === "tablet-768") {
    return 0.04;
  }
  return 0.01;
}

async function assertNoSeriousA11yViolations(page: Page, message: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });
  expect(blockingViolations, message).toEqual([]);
}

test("write compatibility route redirects to admin write", async ({ page }, testInfo) => {
  const maxDiffPixelRatio = getRedirectDiffThreshold(testInfo.project.name);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/write", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await expect(
    page.getByRole("heading", { name: "관리자 로그인" }),
  ).toBeVisible();

  const url = new URL(page.url());
  expect(url.pathname).toBe("/admin/login");
  expect(url.searchParams.get("next")).toBe("/admin/write");

  await assertNoSeriousA11yViolations(
    page,
    `[${testInfo.project.name}] /write has serious/critical accessibility violations`,
  );
  await expect(page).toHaveScreenshot("write-redirect.png", {
    maxDiffPixelRatio,
  });
});

test("write?id compatibility route preserves query on redirect", async ({
  page,
}, testInfo) => {
  const maxDiffPixelRatio = getRedirectDiffThreshold(testInfo.project.name);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/write?id=123", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await expect(
    page.getByRole("heading", { name: "관리자 로그인" }),
  ).toBeVisible();

  const url = new URL(page.url());
  expect(url.pathname).toBe("/admin/login");
  expect(url.searchParams.get("next")).toBe("/admin/write?id=123");

  await assertNoSeriousA11yViolations(
    page,
    `[${testInfo.project.name}] /write?id=123 has serious/critical accessibility violations`,
  );
  await expect(page).toHaveScreenshot("write-redirect-with-query.png", {
    maxDiffPixelRatio,
  });
});
