import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  assertNoHorizontalPageScroll,
  authenticateAdminSession,
  runCleanupScript,
  waitForDocumentTitle,
} from "./helpers";

const DISABLE_ANIMATION_STYLE = `
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

function getWorkspaceDiffThreshold(projectName: string): number {
  // CI 러너 폰트 렌더링 차이로 로그인/관리자 화면에서 줄바꿈 오차가 발생한다.
  if (projectName === "mobile-360") {
    return 0.07;
  }
  if (projectName === "tablet-768") {
    return 0.04;
  }
  return 0.01;
}

async function assertNoSeriousA11yViolations(
  targetPage: import("@playwright/test").Page,
) {
  await waitForDocumentTitle(targetPage);

  const results = await new AxeBuilder({ page: targetPage }).analyze();
  const blocking = results.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });
  expect(blocking).toEqual([]);
}

test.beforeEach(() => {
  runCleanupScript();
});

test("admin workspace visual + functional + accessibility smoke", async ({
  page,
}, testInfo) => {
  const maxDiffPixelRatio = getWorkspaceDiffThreshold(testInfo.project.name);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/admin/login", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
  await expect(
    page.getByRole("heading", { name: "관리자 로그인" }),
  ).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /admin/login has horizontal overflow`,
  );
  await assertNoSeriousA11yViolations(page);
  await expect(page).toHaveScreenshot("admin-login.png", { maxDiffPixelRatio });

  await authenticateAdminSession(page, { nextPath: "/admin/write" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
  await expect(page.getByRole("heading", { name: "새 글 작성" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "관리자 로그아웃" }),
  ).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /admin/write has horizontal overflow`,
  );
  await assertNoSeriousA11yViolations(page);
  await expect(page).toHaveScreenshot("admin-write.png", { maxDiffPixelRatio });

  await page.goto("/admin/notes", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
  await expect(
    page.getByRole("heading", { name: "관리자 메모" }),
  ).toBeVisible();
  await page.getByLabel("제목").fill("UI-ADMIN-NOTE");
  await page.getByLabel("내용").fill("관리자 메모 기능 확인");
  await page.getByRole("button", { name: "메모 추가" }).click();
  await expect(page.getByText("UI-ADMIN-NOTE")).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /admin/notes has horizontal overflow`,
  );
  await assertNoSeriousA11yViolations(page);
  await expect(page).toHaveScreenshot("admin-notes.png", { maxDiffPixelRatio });

  await page.goto("/admin/todos", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
  await expect(
    page.getByRole("heading", { name: "관리자 TODO" }),
  ).toBeVisible();
  await page.getByLabel("제목").fill("UI-ADMIN-TODO");
  await page.getByRole("button", { name: "TODO 추가" }).click();
  await expect(page.getByText("UI-ADMIN-TODO")).toBeVisible();
  const todoCard = page.locator("article").filter({ hasText: "UI-ADMIN-TODO" });
  await expect(todoCard).toBeVisible();
  const nextStatusButton = todoCard.getByRole("button", { name: "다음 상태" });

  await nextStatusButton.click();
  await expect(
    todoCard.getByText("status: doing", { exact: false }),
  ).toBeVisible();

  await nextStatusButton.click();
  await expect(
    todoCard.getByText("status: done", { exact: false }),
  ).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /admin/todos has horizontal overflow`,
  );
  await assertNoSeriousA11yViolations(page);
  await expect(page).toHaveScreenshot("admin-todos.png", { maxDiffPixelRatio });

  await page.goto("/admin/schedules", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
  await expect(
    page.getByRole("heading", { name: "관리자 일정" }),
  ).toBeVisible();
  await page.getByLabel("제목").fill("UI-ADMIN-SCHEDULE");
  await page.getByLabel("시작").fill("2026-01-15T09:00");
  await page.getByLabel("종료").fill("2026-01-15T10:00");
  await page.getByRole("button", { name: "일정 추가" }).click();
  await expect(page.getByText("UI-ADMIN-SCHEDULE")).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /admin/schedules has horizontal overflow`,
  );
  await assertNoSeriousA11yViolations(page);
  await expect(page).toHaveScreenshot("admin-schedules.png", {
    maxDiffPixelRatio,
  });
});
