import { expect, test } from "@playwright/test";
import { resolveApiKey, runCleanupScript } from "./helpers";

const apiKey = resolveApiKey();

test.beforeEach(() => {
  runCleanupScript();
});

async function authenticate(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page
    .locator('main[data-hydrated="true"]')
    .waitFor({ state: "visible" });
  await page.getByLabel("API Key").fill(apiKey);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole("button", { name: "인증 후 편집기 열기" }).click();
    try {
      await expect(
        page.getByRole("heading", { name: /새 글 작성|글 수정 #\d+/ }),
      ).toBeVisible({ timeout: 4_000 });
      return;
    } catch {
      await page.waitForTimeout(300);
    }
  }

  throw new Error("API Key authentication did not transition to editor mode");
}

test("write preview applies typography styles", async ({ page }) => {
  await page.goto("/write", { waitUntil: "networkidle" });
  await authenticate(page);

  await page
    .getByPlaceholder("마크다운 본문을 입력하세요")
    .fill("# 제목\n\n본문\n\n- 항목\n\n```js\nconsole.log(1)\n```");

  const preview = page.locator("article.markdown-preview");
  await expect(preview.locator("h1")).toBeVisible();
  await expect(preview.locator("p").first()).toBeVisible();
  await expect(preview.locator("ul")).toBeVisible();
  await expect(preview.locator("pre")).toBeVisible();

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
