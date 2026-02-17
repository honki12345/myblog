import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  assertNoHorizontalPageScroll,
  authenticateAdminSession,
  seedVisualPosts,
  waitForDocumentTitle,
} from "./helpers";

const THUMBNAIL_SEED_TITLE = "PW-SEED-홈 화면 글";
const NO_THUMBNAIL_SEED_TITLE = "PW-SEED-목록 화면 글";
const FALLBACK_THUMBNAIL_SEED_TITLE = "PW-SEED-태그 화면 글";

type SeededPosts = { detailSlug: string };

type RouteName =
  | "home"
  | "posts"
  | "post-detail"
  | "admin-write"
  | "tags"
  | "tag-sample";

type Route = { name: RouteName; getPath: (seeded: SeededPosts) => string };

const routes: Route[] = [
  { name: "home", getPath: () => "/" },
  { name: "posts", getPath: () => "/posts" },
  {
    name: "post-detail",
    getPath: (seeded) => `/posts/${seeded.detailSlug}`,
  },
  {
    name: "admin-write",
    getPath: () => "/admin/write",
  },
  { name: "tags", getPath: () => "/tags" },
  {
    name: "tag-sample",
    getPath: () => "/tags/sample",
  },
];

function getVisualDiffThreshold(projectName: string): number {
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

function getPostCardByTitle(page: Page, title: string) {
  return page
    .locator("article[data-post-card]")
    .filter({ has: page.getByRole("link", { name: title }) });
}

async function assertNoSeriousA11yViolations(page: Page, message: string) {
  await waitForDocumentTitle(page);

  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });

  expect(blockingViolations, message).toEqual([]);
}

for (const route of routes) {
  test(`visual snapshot: ${route.name}`, async ({
    page,
    request,
  }, testInfo) => {
    const seeded = await seedVisualPosts(request);
    const routePath = route.getPath(seeded);

    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    if (route.name === "admin-write") {
      await authenticateAdminSession(page, { nextPath: "/admin/write" });
      await page.waitForLoadState("networkidle");
    } else {
      await page.goto(routePath, { waitUntil: "networkidle" });
    }

    await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
    await expect(page.locator("main").first()).toBeVisible();

    if (
      route.name === "home" ||
      route.name === "posts" ||
      route.name === "tag-sample"
    ) {
      const cardWithThumbnail = getPostCardByTitle(page, THUMBNAIL_SEED_TITLE);
      await expect(cardWithThumbnail).toBeVisible();
      await expect(
        cardWithThumbnail.locator("[data-post-thumbnail]"),
      ).toBeVisible();
      await expect(
        cardWithThumbnail.getByRole("link", {
          name: `${THUMBNAIL_SEED_TITLE} 썸네일`,
        }),
      ).toHaveCount(0);
      await expect(
        cardWithThumbnail
          .locator(
            'a, button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"])',
          )
          .first(),
      ).toHaveAccessibleName(THUMBNAIL_SEED_TITLE);

      const cardWithoutThumbnail = getPostCardByTitle(
        page,
        NO_THUMBNAIL_SEED_TITLE,
      );
      await expect(cardWithoutThumbnail).toBeVisible();
      await expect(
        cardWithoutThumbnail.locator("[data-post-thumbnail]"),
      ).toHaveCount(0);
      await expect(
        cardWithoutThumbnail
          .locator(
            'a, button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"])',
          )
          .first(),
      ).toHaveAccessibleName(NO_THUMBNAIL_SEED_TITLE);

      const cardWithFallback = getPostCardByTitle(
        page,
        FALLBACK_THUMBNAIL_SEED_TITLE,
      );
      await expect(cardWithFallback).toBeVisible();
      await expect(
        cardWithFallback.locator("[data-post-thumbnail]"),
      ).toBeVisible();
      await expect(
        cardWithFallback.getByRole("link", {
          name: `${FALLBACK_THUMBNAIL_SEED_TITLE} 썸네일`,
        }),
      ).toHaveCount(0);
      await expect(
        cardWithFallback
          .locator(
            'a, button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"])',
          )
          .first(),
      ).toHaveAccessibleName(FALLBACK_THUMBNAIL_SEED_TITLE);

      // Wait until all thumbnails on the page settle (loaded or fallback),
      // so screenshots don't capture hydration timing issues.
      const thumbnails = page.locator("[data-post-thumbnail]");
      const thumbnailCount = await thumbnails.count();
      if (thumbnailCount > 0) {
        await expect
          .poll(async () => {
            const states = await thumbnails.evaluateAll((nodes) =>
              nodes.map((node) =>
                node.getAttribute("data-post-thumbnail-state"),
              ),
            );
            return states.every(
              (value) => value === "loaded" || value === "fallback",
            );
          })
          .toBe(true);
      }

      await expect
        .poll(async () => {
          return await cardWithThumbnail
            .locator("[data-post-thumbnail]")
            .getAttribute("data-post-thumbnail-state");
        })
        .toBe("loaded");

      await expect
        .poll(async () => {
          return await cardWithFallback
            .locator("[data-post-thumbnail]")
            .getAttribute("data-post-thumbnail-state");
        })
        .toBe("fallback");
    }

    if (route.name === "home") {
      await expect(
        page.getByRole("heading", { name: "홈", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "태그 허브" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "최신 직접 작성" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "최신 AI 수집" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "글 목록" })).toBeVisible();
    }

    if (route.name === "posts") {
      await expect(
        page.getByRole("heading", { name: "글 목록" }),
      ).toBeVisible();
      await expect(page.locator("article").first()).toBeVisible();
    }

    if (route.name === "post-detail") {
      await expect(
        page.getByRole("heading", { name: THUMBNAIL_SEED_TITLE }),
      ).toBeVisible();
      const content = page.locator("article.markdown-content");
      await expect(content).toBeVisible();
      await expect(content.locator("pre")).toBeVisible();
      await expect(content.locator("table")).toBeVisible();
      await expect(content.locator(".katex")).toBeVisible();
    }

    if (route.name === "admin-write") {
      await expect(
        page.getByRole("heading", { name: "새 글 작성" }),
      ).toBeVisible();
      await expect(page.getByLabel("제목")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "관리자 로그아웃" }),
      ).toBeVisible();
    }

    if (route.name === "tag-sample") {
      await expect(
        page.getByRole("heading", { name: "태그: sample" }),
      ).toBeVisible();
      await expect(page.locator("article").first()).toBeVisible();
    }

    if (route.name === "tags") {
      await expect(page.getByRole("heading", { name: "태그" })).toBeVisible();
      await expect(page.getByRole("link", { name: /#sample/ })).toBeVisible();
    }

    await assertNoHorizontalPageScroll(
      page,
      `[${testInfo.project.name}] ${routePath} has horizontal overflow`,
    );

    await assertNoSeriousA11yViolations(
      page,
      `[${testInfo.project.name}] ${routePath} has serious/critical accessibility violations`,
    );

    const maxDiffPixelRatio = getVisualDiffThreshold(testInfo.project.name);
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: false,
      maxDiffPixelRatio,
    });
  });
}
