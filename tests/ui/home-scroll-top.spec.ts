import { expect, test, type Page } from "@playwright/test";
import {
  authenticateAdminSession,
  waitForDocumentTitle,
} from "./helpers";

const HOME_TITLE_LINK_SELECTOR = 'header a[aria-label="홈 (honki12345 블로그)"]';

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

test("home title link scrolls to top when already on /wiki", async ({ page }) => {
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
}) => {
  await authenticateAdminSession(page, { nextPath: "/wiki/sample" });
  await page.waitForLoadState("networkidle");
  await waitForDocumentTitle(page);

  await expect(page).toHaveURL(/\/wiki\/sample$/);

  const titleLink = getHomeTitleLink(page);
  await expect(titleLink).toHaveCount(1);
  await expect(titleLink).toHaveAttribute("href", "/wiki");
  await expect(titleLink).not.toHaveAttribute("aria-current", "page");

  await titleLink.click();
  await expect(page).toHaveURL(/\/wiki$/);
  await expect(titleLink).toHaveAttribute("aria-current", "page");

  const wikiIndexProbe = await probeHomeTitleClickBehavior(page);
  expect(wikiIndexProbe.plain.defaultPrevented).toBe(true);
  expect(wikiIndexProbe.plain.dispatchResult).toBe(false);

  for (const key of ["meta", "ctrl", "shift", "alt", "middle"] as const) {
    expect(wikiIndexProbe[key].defaultPrevented).toBe(false);
    expect(wikiIndexProbe[key].dispatchResult).toBe(true);
  }
});
