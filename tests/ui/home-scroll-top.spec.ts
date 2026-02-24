import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  authenticateAdminSession,
  insertCommentDirect,
  insertPostDirect,
  runCleanupScript,
  waitForDocumentTitle,
} from "./helpers";

const HOME_TITLE_LINK_SELECTOR =
  'header a[aria-label="홈 (honki12345 블로그)"]';
const HOME_SCROLL_TOP_SEED = "home-scroll-top-seed-123";
const DISABLE_ANIMATION_STYLE = `
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

type ClickProbeResult = {
  defaultPrevented: boolean;
  dispatchResult: boolean;
};

type HomeTitleClickProbe = {
  plain: ClickProbeResult;
  meta: ClickProbeResult;
  ctrl: ClickProbeResult;
  shift: ClickProbeResult;
  alt: ClickProbeResult;
  middle: ClickProbeResult;
};

function getHomeTitleLink(page: Page) {
  return page.locator(HOME_TITLE_LINK_SELECTOR);
}

function getHomeScrollTopDiffThreshold(projectName: string): number {
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

async function probeHomeTitleClickBehavior(
  page: Page,
): Promise<HomeTitleClickProbe> {
  return page.evaluate((selector) => {
    const homeTitleLink = document.querySelector(selector);
    if (!(homeTitleLink instanceof HTMLAnchorElement)) {
      throw new Error("home title link not found");
    }

    const probe = (init: MouseEventInit) => {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });

      const dispatchResult = homeTitleLink.dispatchEvent(event);
      return {
        defaultPrevented: event.defaultPrevented,
        dispatchResult,
      };
    };

    return {
      plain: probe({ button: 0 }),
      meta: probe({ button: 0, metaKey: true }),
      ctrl: probe({ button: 0, ctrlKey: true }),
      shift: probe({ button: 0, shiftKey: true }),
      alt: probe({ button: 0, altKey: true }),
      middle: probe({ button: 1 }),
    };
  }, HOME_TITLE_LINK_SELECTOR);
}

test.beforeEach(() => {
  runCleanupScript();
});

test("home title link scrolls to top when already on /wiki", async ({
  page,
}) => {
  await authenticateAdminSession(page, { nextPath: "/wiki" });
  await page.waitForLoadState("networkidle");
  await waitForDocumentTitle(page);
  await expect(
    page.getByRole("heading", { name: "위키", level: 1, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/wiki$/);

  const titleLink = getHomeTitleLink(page);
  await expect(titleLink).toHaveCount(1);
  await expect(titleLink).toHaveAttribute(
    "aria-label",
    "홈 (honki12345 블로그)",
  );
  await expect(titleLink).toHaveAttribute("aria-current", "page");
  await expect(titleLink).toHaveClass(/focus-visible:ring-2/);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const isFocused = await titleLink.evaluate((node) => {
      return node === document.activeElement;
    });
    if (isFocused) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(titleLink).toBeFocused();

  await page.evaluate(() => {
    document.body.style.minHeight = "4000px";
    window.scrollTo(0, Math.max(document.body.scrollHeight, 2000));
  });

  await expect
    .poll(async () => {
      return await page.evaluate(() => window.scrollY);
    })
    .toBeGreaterThan(0);

  await titleLink.click();

  await expect
    .poll(async () => {
      return await page.evaluate(() => window.scrollY);
    })
    .toBe(0);
  await expect(page).toHaveURL(/\/wiki$/);
});

test("home title link keeps navigation policy across wiki paths and modifier keys", async ({
  page,
  request,
}, testInfo) => {
  const seed = HOME_SCROLL_TOP_SEED;
  const wikiPath = `home-scroll-top/${HOME_SCROLL_TOP_SEED}`;
  const escapedWikiPath = wikiPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const seededPost = await insertPostDirect(request, {
    title: `PW-SEED-HOME-TITLE-LINK-${seed}`,
    content: "홈 타이틀 링크 경로 시드",
    tags: ["home-scroll-top"],
    status: "published",
    sourceUrl: `https://playwright.seed/home-scroll-top/${seed}`,
    origin: "original",
  });
  await insertCommentDirect(request, {
    postId: seededPost.id,
    content: "홈 타이틀 링크 위키 경로 시드",
    tagPath: wikiPath,
    isHidden: false,
  });

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await authenticateAdminSession(page, { nextPath: `/wiki/${wikiPath}` });
  await page.waitForLoadState("networkidle");
  await waitForDocumentTitle(page);
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await expect(page).toHaveURL(new RegExp(`/wiki/${escapedWikiPath}$`));

  const titleLink = getHomeTitleLink(page);
  await expect(titleLink).toHaveCount(1);
  await expect(titleLink).toHaveAttribute("href", "/wiki");
  await expect(titleLink).not.toHaveAttribute("aria-current", "page");

  await titleLink.click();
  await expect(page).toHaveURL(/\/wiki$/);
  await expect(titleLink).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "위키", level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`^위키 경로: /${escapedWikiPath}$`),
    }),
  ).toHaveCount(0);
  await expectNoSeriousA11y(page);
  await expect(page).toHaveScreenshot("home-scroll-top-wiki-root.png", {
    maxDiffPixelRatio: getHomeScrollTopDiffThreshold(testInfo.project.name),
  });

  const wikiIndexProbe = await probeHomeTitleClickBehavior(page);
  expect(wikiIndexProbe.plain.defaultPrevented).toBe(true);
  expect(wikiIndexProbe.plain.dispatchResult).toBe(false);

  for (const key of ["meta", "ctrl", "shift", "alt", "middle"] as const) {
    expect(wikiIndexProbe[key].defaultPrevented).toBe(false);
    expect(wikiIndexProbe[key].dispatchResult).toBe(true);
  }
});
