import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedVisualPosts } from "./helpers";

test("critical pages have no serious axe violations", async ({
  page,
  request,
}) => {
  const seeded = await seedVisualPosts(request);
  const targets = ["/", "/posts", `/posts/${seeded.detailSlug}`, "/admin/login"];

  for (const target of targets) {
    await page.goto(target, { waitUntil: "networkidle" });

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
