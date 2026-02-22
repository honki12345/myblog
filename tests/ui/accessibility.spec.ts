import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  authenticateAdminSession,
  seedVisualPosts,
  waitForDocumentTitle,
} from "./helpers";

test("critical pages have no serious axe violations", async ({
  page,
  request,
}) => {
  const seeded = await seedVisualPosts(request);
  const loggedOutTargets = [
    "/",
    "/wiki",
    `/wiki/${seeded.wikiPath}`,
    "/posts",
    `/posts/${seeded.detailSlug}`,
    "/tags",
    "/tags/sample",
    "/admin/login",
  ];

  for (const target of loggedOutTargets) {
    await page.goto(target, { waitUntil: "networkidle" });
    await waitForDocumentTitle(page);

    const results = await new AxeBuilder({ page }).analyze();
    const blockingViolations = results.violations.filter((violation) => {
      return violation.impact === "critical" || violation.impact === "serious";
    });

    expect(
      blockingViolations,
      `${target} has serious/critical accessibility violations`,
    ).toEqual([]);
  }

  await authenticateAdminSession(page, { nextPath: "/" });
  await page.waitForLoadState("networkidle");

  const adminTargets = [
    "/",
    "/posts",
    `/posts/${seeded.detailSlug}`,
    "/tags",
    "/tags/sample",
  ];

  for (const target of adminTargets) {
    await page.goto(target, { waitUntil: "networkidle" });
    await waitForDocumentTitle(page);

    const results = await new AxeBuilder({ page }).analyze();
    const blockingViolations = results.violations.filter((violation) => {
      return violation.impact === "critical" || violation.impact === "serious";
    });

    expect(
      blockingViolations,
      `${target} has serious/critical accessibility violations`,
    ).toEqual([]);
  }
});
