import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedVisualPosts, waitForDocumentTitle } from "./helpers";

test("critical pages have no serious axe violations", async ({
  page,
  request,
}) => {
  const seeded = await seedVisualPosts(request);
  const targets = [
    "/",
    "/posts",
    `/posts/${seeded.detailSlug}`,
    "/tags",
    "/tags?q=sa",
    "/tags/sample",
    "/wiki",
    `/wiki/${seeded.wikiPath}`,
    "/admin/login",
  ];

  for (const target of targets) {
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
