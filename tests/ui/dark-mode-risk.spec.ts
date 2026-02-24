import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  assertNoHorizontalPageScroll,
  authenticateAdminSession,
  seedVisualPosts,
  waitForDocumentTitle,
} from "./helpers";

const DETAIL_SEED_TITLE = "PW-SEED-홈 화면 글";

type SeededPosts = { detailSlug: string };
type RouteName =
  | "wiki"
  | "posts"
  | "post-detail"
  | "admin-login"
  | "admin-write"
  | "admin-notes"
  | "admin-todos"
  | "admin-schedules"
  | "admin-guestbook";

type DarkRoute = {
  name: RouteName;
  getPath: (seeded: SeededPosts) => string;
  requiresAdmin: boolean;
  assertVisible: (page: Page, seeded: SeededPosts) => Promise<void>;
};

type EmulateMediaOptions = Parameters<Page["emulateMedia"]>[0] & {
  contrast?: "more" | "no-preference";
};

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

const routes: DarkRoute[] = [
  {
    name: "wiki",
    getPath: () => "/wiki",
    requiresAdmin: false,
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: "위키", level: 1, exact: true }),
      ).toBeVisible();
      await expect(page.locator("[data-wiki-explorer]")).toBeVisible();
    },
  },
  {
    name: "posts",
    getPath: () => "/posts",
    requiresAdmin: true,
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: "글 목록", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator("article[data-post-card]").first(),
      ).toBeVisible();
    },
  },
  {
    name: "post-detail",
    getPath: (seeded) => `/posts/${seeded.detailSlug}`,
    requiresAdmin: true,
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: DETAIL_SEED_TITLE, exact: true }),
      ).toBeVisible();
      await expect(page.locator("article.markdown-content")).toBeVisible();
    },
  },
  {
    name: "admin-login",
    getPath: () => "/admin/login",
    requiresAdmin: false,
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: "관리자 로그인", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("아이디")).toBeVisible();
    },
  },
  {
    name: "admin-write",
    getPath: () => "/admin/write",
    requiresAdmin: true,
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: "새 글 작성", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("제목")).toBeVisible();
    },
  },
  {
    name: "admin-notes",
    getPath: () => "/admin/notes",
    requiresAdmin: true,
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: "관리자 메모", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("제목")).toBeVisible();
    },
  },
  {
    name: "admin-todos",
    getPath: () => "/admin/todos",
    requiresAdmin: true,
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: "관리자 TODO", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("제목")).toBeVisible();
    },
  },
  {
    name: "admin-schedules",
    getPath: () => "/admin/schedules",
    requiresAdmin: true,
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: "관리자 일정", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("제목")).toBeVisible();
    },
  },
  {
    name: "admin-guestbook",
    getPath: () => "/admin/guestbook",
    requiresAdmin: true,
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", {
          name: "프라이빗 방명록 인박스",
          exact: true,
        }),
      ).toBeVisible();
    },
  },
];

function getVisualDiffThreshold(projectName: string): number {
  if (projectName === "mobile-360") {
    return 0.09;
  }
  if (projectName === "tablet-768") {
    return 0.07;
  }
  if (projectName === "desktop-1440") {
    return 0.03;
  }
  return 0.01;
}

async function emulateMedia(
  page: Page,
  options: EmulateMediaOptions,
): Promise<void> {
  await page.emulateMedia(
    options as unknown as Parameters<Page["emulateMedia"]>[0],
  );
}

async function assertNoSeriousA11y(page: Page, message: string): Promise<void> {
  await waitForDocumentTitle(page);

  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });

  expect(blockingViolations, message).toEqual([]);
}

async function assertKeyboardFocusIndicator(page: Page): Promise<void> {
  await page.keyboard.press("Tab");

  const hasVisibleFocusIndicator = await page.evaluate(() => {
    const activeElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (!activeElement || activeElement === document.body) {
      return false;
    }

    const styles = window.getComputedStyle(activeElement);
    const outlineWidth = Number.parseFloat(styles.outlineWidth);
    const hasExplicitFocusStyle =
      (styles.outlineStyle !== "none" && outlineWidth > 0) ||
      styles.boxShadow !== "none";

    return activeElement.matches(":focus-visible") && hasExplicitFocusStyle;
  });

  expect(hasVisibleFocusIndicator).toBe(true);
}

for (const route of routes) {
  test(`@visual dark mode snapshot: ${route.name}`, async ({
    page,
    request,
  }, testInfo) => {
    const seeded = await seedVisualPosts(request);
    const routePath = route.getPath(seeded);

    await emulateMedia(page, {
      colorScheme: "dark",
      reducedMotion: "reduce",
      forcedColors: "none",
      contrast: "no-preference",
    });

    if (route.requiresAdmin) {
      await authenticateAdminSession(page, { nextPath: routePath });
      await page.waitForLoadState("networkidle");
    } else {
      await page.goto(routePath, { waitUntil: "networkidle" });
    }

    await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
    await route.assertVisible(page, seeded);
    await assertNoHorizontalPageScroll(
      page,
      `[${testInfo.project.name}] dark ${routePath} has horizontal overflow`,
    );
    await assertNoSeriousA11y(
      page,
      `[${testInfo.project.name}] dark ${routePath} has serious/critical accessibility violations`,
    );

    await expect(page).toHaveScreenshot(`dark-${route.name}.png`, {
      fullPage: false,
      maxDiffPixelRatio: getVisualDiffThreshold(testInfo.project.name),
    });
  });
}

test("forced-colors and prefers-contrast modes keep controls readable", async ({
  page,
  request,
}, testInfo) => {
  const seeded = await seedVisualPosts(request);
  let authenticated = false;
  const checks = [
    {
      name: "forced-colors-wiki",
      path: "/wiki",
      requiresAdmin: false,
      media: {
        colorScheme: "dark",
        reducedMotion: "reduce",
        forcedColors: "active",
        contrast: "more",
      } satisfies EmulateMediaOptions,
      assertVisible: async () => {
        await expect(
          page.getByRole("heading", { name: "위키", level: 1, exact: true }),
        ).toBeVisible();
      },
    },
    {
      name: "contrast-admin-write",
      path: "/admin/write",
      requiresAdmin: true,
      media: {
        colorScheme: "dark",
        reducedMotion: "reduce",
        forcedColors: "none",
        contrast: "more",
      } satisfies EmulateMediaOptions,
      assertVisible: async () => {
        await expect(
          page.getByRole("heading", { name: "새 글 작성", exact: true }),
        ).toBeVisible();
        await expect(page.getByLabel("제목")).toBeVisible();
      },
    },
    {
      name: "forced-colors-post-detail",
      path: `/posts/${seeded.detailSlug}`,
      requiresAdmin: true,
      media: {
        colorScheme: "dark",
        reducedMotion: "reduce",
        forcedColors: "active",
        contrast: "more",
      } satisfies EmulateMediaOptions,
      assertVisible: async () => {
        await expect(
          page.getByRole("heading", { name: DETAIL_SEED_TITLE, exact: true }),
        ).toBeVisible();
      },
    },
  ];

  for (const check of checks) {
    await emulateMedia(page, check.media);
    if (check.requiresAdmin) {
      if (!authenticated) {
        await authenticateAdminSession(page, { nextPath: check.path });
        await page.waitForLoadState("networkidle");
        authenticated = true;
      } else {
        await page.goto(check.path, { waitUntil: "networkidle" });
      }
    } else {
      await page.goto(check.path, { waitUntil: "networkidle" });
    }

    await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });
    await check.assertVisible();
    await assertKeyboardFocusIndicator(page);
    await assertNoHorizontalPageScroll(
      page,
      `[${testInfo.project.name}] ${check.name} has horizontal overflow`,
    );
    await assertNoSeriousA11y(
      page,
      `[${testInfo.project.name}] ${check.name} has serious/critical accessibility violations`,
    );
  }
});
