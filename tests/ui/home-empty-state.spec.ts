import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { runCleanupScript, waitForDocumentTitle } from "./helpers";

const DISABLE_ANIMATION_STYLE = `
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

function getEmptyStateDiffThreshold(projectName: string): number {
  // CI runner의 폰트 메트릭 차이로 모바일/태블릿 스냅샷에
  // 경미한 줄바꿈/레이아웃 오차가 발생하므로 뷰포트별 허용치로 고정한다.
  if (projectName === "mobile-360") {
    return 0.08;
  }
  if (projectName === "tablet-768") {
    return 0.06;
  }
  // GitHub Actions runner에서도 데스크톱 폰트 렌더링 차이로 미세한 diff가 발생할 수 있다.
  if (projectName === "desktop-1440") {
    return 0.02;
  }
  return 0.01;
}

async function assertNoSeriousA11yViolations(page: Page) {
  await waitForDocumentTitle(page);

  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });

  expect(blockingViolations).toEqual([]);
}

test("home: 위키 루트 빈 상태 안내문이 노출된다", async ({
  page,
}, testInfo) => {
  runCleanupScript();

  const maxDiffPixelRatio = getEmptyStateDiffThreshold(testInfo.project.name);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "위키", level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("아직 공개된 위키 데이터가 없습니다."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "관리자 빠른 이동" }),
  ).toHaveCount(0);

  await assertNoSeriousA11yViolations(page);

  await expect(page).toHaveScreenshot("home-empty-state.png", {
    fullPage: false,
    maxDiffPixelRatio,
  });
});
