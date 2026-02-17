import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  authenticateAdminSession,
  runCleanupScript,
  waitForDocumentTitle,
} from "./helpers";

test.beforeEach(() => {
  runCleanupScript();
});

test("write preview applies typography styles", async ({ page }) => {
  await authenticateAdminSession(page, { nextPath: "/admin/write" });

  await page
    .getByPlaceholder("마크다운 본문을 입력하세요")
    .fill("# 제목\n\n본문\n\n- 항목\n\n```js\nconsole.log(1)\n```");

  const preview = page.locator("article.markdown-preview");
  await expect(preview.locator("h1")).toBeVisible();
  await expect(preview.locator("p").first()).toBeVisible();
  await expect(preview.locator("ul")).toBeVisible();
  await expect(preview.locator("pre")).toBeVisible();
  await expect(preview).toHaveScreenshot("write-preview-typography.png");

  await waitForDocumentTitle(page);

  const accessibility = await new AxeBuilder({ page })
    .include("article.markdown-preview")
    .analyze();
  const blockingViolations = accessibility.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });
  expect(
    blockingViolations,
    "write preview has serious/critical accessibility violations",
  ).toEqual([]);

  const styles = await preview.evaluate((node) => {
    const h1 = node.querySelector("h1");
    const p = node.querySelector("p");
    const ul = node.querySelector("ul");
    const pre = node.querySelector("pre");
    if (!h1 || !p || !ul || !pre) {
      return null;
    }

    const h1Style = getComputedStyle(h1);
    const pStyle = getComputedStyle(p);
    const ulStyle = getComputedStyle(ul);
    const preStyle = getComputedStyle(pre);

    return {
      h1: {
        fontSize: h1Style.fontSize,
        fontWeight: h1Style.fontWeight,
      },
      p: {
        fontSize: pStyle.fontSize,
        fontWeight: pStyle.fontWeight,
      },
      ul: {
        listStyleType: ulStyle.listStyleType,
        paddingLeft: ulStyle.paddingLeft,
      },
      pre: {
        backgroundColor: preStyle.backgroundColor,
        padding: preStyle.padding,
      },
    };
  });

  expect(styles).not.toBeNull();
  expect(styles?.h1.fontSize).not.toBe(styles?.p.fontSize);
  expect(styles?.h1.fontWeight).not.toBe(styles?.p.fontWeight);
  expect(styles?.ul.listStyleType).not.toBe("none");
  expect(styles?.ul.paddingLeft).not.toBe("0px");
  expect(styles?.pre.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles?.pre.padding).not.toBe("0px");
});
