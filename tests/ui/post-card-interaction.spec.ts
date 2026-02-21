import { expect, test, type Locator, type Page } from "@playwright/test";
import { authenticateAdminSession, seedVisualPosts } from "./helpers";

const THUMBNAIL_SEED_TITLE = "PW-SEED-홈 화면 글";
const NO_THUMBNAIL_SEED_TITLE = "PW-SEED-목록 화면 글";

function getPostCardByTitle(page: Page, title: string) {
  return page
    .locator("article[data-post-card]")
    .filter({ has: page.getByRole("link", { name: title }) });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function gotoArchive(page: Page): Promise<void> {
  await page.goto("/posts?per_page=50", { waitUntil: "networkidle" });
}

async function clickAtCenter(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, "Expected locator to have a bounding box").not.toBeNull();
  if (!box) {
    return;
  }

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function clickWhitespaceAboveTags(
  page: Page,
  card: Locator,
): Promise<void> {
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  expect(cardBox, "Expected card to have a bounding box").not.toBeNull();
  if (!cardBox) {
    return;
  }

  const tags = card.locator("ul").first();
  await expect(tags).toBeVisible();
  await tags.scrollIntoViewIfNeeded();
  const tagsBox = await tags.boundingBox();
  expect(tagsBox, "Expected tag list to have a bounding box").not.toBeNull();
  if (!tagsBox) {
    return;
  }

  // Keep the click point inside the card but above tag chips.
  const padding = 8;
  const x = cardBox.x + cardBox.width - padding;
  const y = Math.max(cardBox.y + padding, tagsBox.y - padding);
  await page.mouse.click(x, y);
}

test("admin: post cards are clickable across thumbnail/summary/whitespace", async ({
  page,
  request,
}) => {
  const seeded = await seedVisualPosts(request);
  const expectedDetailHref = `/posts/${seeded.detailSlug}`;
  await authenticateAdminSession(page, { nextPath: "/posts?per_page=50" });
  await page.waitForLoadState("networkidle");

  await gotoArchive(page);
  const cardWithThumbnail = getPostCardByTitle(page, THUMBNAIL_SEED_TITLE);

  await clickAtCenter(page, cardWithThumbnail.locator("[data-post-thumbnail]"));
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(expectedDetailHref)}$`),
  );
  await expect(
    page.getByRole("heading", { name: THUMBNAIL_SEED_TITLE }),
  ).toBeVisible();

  await gotoArchive(page);
  await clickAtCenter(
    page,
    cardWithThumbnail.locator("p:not([data-post-date])").first(),
  );
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(expectedDetailHref)}$`),
  );
  await expect(
    page.getByRole("heading", { name: THUMBNAIL_SEED_TITLE }),
  ).toBeVisible();

  await gotoArchive(page);
  await clickWhitespaceAboveTags(page, cardWithThumbnail);
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(expectedDetailHref)}$`),
  );
  await expect(
    page.getByRole("heading", { name: THUMBNAIL_SEED_TITLE }),
  ).toBeVisible();

  await gotoArchive(page);
  const cardWithoutThumbnail = getPostCardByTitle(
    page,
    NO_THUMBNAIL_SEED_TITLE,
  );
  const expectedNoThumbnailHref =
    (await cardWithoutThumbnail
      .getByRole("link", { name: NO_THUMBNAIL_SEED_TITLE })
      .getAttribute("href")) ?? "";

  expect(expectedNoThumbnailHref).toMatch(/^\/posts\//);

  await clickAtCenter(
    page,
    cardWithoutThumbnail.locator("p:not([data-post-date])").first(),
  );
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(expectedNoThumbnailHref)}$`),
  );
  await expect(
    page.getByRole("heading", { name: NO_THUMBNAIL_SEED_TITLE }),
  ).toBeVisible();

  await gotoArchive(page);
  await clickWhitespaceAboveTags(page, cardWithoutThumbnail);
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(expectedNoThumbnailHref)}$`),
  );
  await expect(
    page.getByRole("heading", { name: NO_THUMBNAIL_SEED_TITLE }),
  ).toBeVisible();
});

test("admin: tag chips take precedence over card navigation", async ({
  page,
  request,
}) => {
  await seedVisualPosts(request);
  await authenticateAdminSession(page, { nextPath: "/posts?per_page=50" });
  await page.waitForLoadState("networkidle");
  await gotoArchive(page);

  const card = getPostCardByTitle(page, THUMBNAIL_SEED_TITLE);
  const tagLink = card.getByRole("link", { name: "#sample", exact: true });

  await tagLink.click();
  await expect(page).toHaveURL(/\/wiki\/sample$/);
  await expect(
    page.getByRole("heading", { name: "위키 경로: /sample" }),
  ).toBeVisible();
});

test("admin: post cards expose focus-visible feedback on keyboard navigation", async ({
  page,
  request,
}) => {
  await seedVisualPosts(request);
  await authenticateAdminSession(page, { nextPath: "/posts?per_page=50" });
  await page.waitForLoadState("networkidle");
  await gotoArchive(page);

  const card = getPostCardByTitle(page, THUMBNAIL_SEED_TITLE);
  const titleLink = card.getByRole("link", { name: THUMBNAIL_SEED_TITLE });

  const borderBefore = await card.evaluate((node) => {
    return getComputedStyle(node).borderTopColor;
  });

  // Move focus using keyboard (so :focus-visible can match), then wait for the card link.
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const isFocused = await titleLink.evaluate((node) => {
      return node === document.activeElement;
    });
    if (isFocused) {
      break;
    }
    await page.keyboard.press("Tab");
  }

  await expect(titleLink).toBeFocused();
  const focusVisible = await titleLink.evaluate((node) => {
    return node.matches(":focus-visible");
  });
  expect(focusVisible).toBe(true);

  const borderAfter = await card.evaluate((node) => {
    return getComputedStyle(node).borderTopColor;
  });
  expect(borderAfter).not.toBe(borderBefore);
});
