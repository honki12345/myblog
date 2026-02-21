import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  assertNoHorizontalPageScroll,
  authenticateAdminSession,
  insertPostDirect,
  runCleanupScript,
  waitForDocumentTitle,
  type SeededPost,
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

function getWikiDiffThreshold(projectName: string): number {
  if (projectName === "mobile-360") {
    return 0.04;
  }
  if (projectName === "tablet-768") {
    return 0.05;
  }
  return 0.03;
}

async function expectNoSeriousA11y(page: Page) {
  await waitForDocumentTitle(page);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((item) => {
    return item.impact === "critical" || item.impact === "serious";
  });
  expect(blocking).toEqual([]);
}

test.beforeEach(() => {
  runCleanupScript();
});

test("admin manages post comments and wiki pages expose only visible comments", async ({
  page,
}, testInfo) => {
  const seed: SeededPost = {
    title: "PW-SEED-WIKI-COMMENTS",
    content: "위키 댓글 관리 테스트 대상 본문",
    tags: ["wiki", "comments"],
    status: "published",
    sourceUrl: "https://playwright.seed/wiki-comments-source",
    origin: "ai",
  };

  const created = await insertPostDirect(page.request, seed);

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await authenticateAdminSession(page, { nextPath: `/posts/${created.slug}` });
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await expect(
    page.getByRole("heading", { name: "댓글 위키 관리" }),
  ).toBeVisible();
  await expect(
    page.locator("[data-post-comments-admin] [data-comment-list] li"),
  ).toHaveCount(0);

  await page.getByLabel("댓글 내용").fill("첫 댓글: 위키 루트 경로");
  await page.getByLabel("태그 경로").fill("AI/Platform");
  await page.getByRole("button", { name: "댓글 추가" }).click();
  await expect(page.getByText("댓글을 추가했습니다.")).toBeVisible();

  await expect(
    page.locator("[data-comment-list] [data-comment-id]").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "수정" }).first().click();
  await page.getByLabel("댓글 내용").fill("수정된 댓글: nextjs 하위 경로");
  await page.getByLabel("태그 경로").fill("ai/platform/nextjs");
  await page.getByRole("button", { name: "댓글 저장" }).click();
  await expect(page.getByText("댓글을 수정했습니다.")).toBeVisible();

  await page.getByLabel("댓글 내용").fill("숨김 댓글: 노출되면 안 됨");
  await page.getByLabel("태그 경로").fill("ai/platform/hidden");
  await page.getByLabel("숨김 처리").check();
  await page.getByRole("button", { name: "댓글 추가" }).click();
  await expect(page.getByText("댓글을 추가했습니다.")).toBeVisible();

  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /posts/${created.slug} has horizontal overflow`,
  );
  await expectNoSeriousA11y(page);
  await expect(page.locator("main")).toHaveScreenshot(
    "post-detail-comments-admin.png",
    {
      maxDiffPixelRatio: getWikiDiffThreshold(testInfo.project.name),
    },
  );

  await page.goto("/wiki", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
  await expect(page.getByRole("heading", { name: "댓글 위키" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ai" })).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /wiki has horizontal overflow`,
  );
  await expectNoSeriousA11y(page);
  await expect(page).toHaveScreenshot("wiki-index.png", {
    maxDiffPixelRatio: getWikiDiffThreshold(testInfo.project.name),
  });

  await page.goto("/wiki/ai/platform", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await expect(
    page.getByRole("heading", { name: "위키 경로: /ai/platform" }),
  ).toBeVisible();
  await expect(page.getByText("수정된 댓글: nextjs 하위 경로")).toBeVisible();
  await expect(page.getByText("숨김 댓글: 노출되면 안 됨")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "/ai/platform/nextjs", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "원문 링크" })).toHaveAttribute(
    "href",
    seed.sourceUrl ?? "",
  );
  await expect(page.getByRole("link", { name: "wiki" })).toHaveAttribute(
    "href",
    "/wiki",
  );
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /wiki/ai/platform has horizontal overflow`,
  );
  await expectNoSeriousA11y(page);
  await expect(page).toHaveScreenshot("wiki-path.png", {
    maxDiffPixelRatio: getWikiDiffThreshold(testInfo.project.name),
  });
});
