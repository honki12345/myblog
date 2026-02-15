import { expect, test } from "@playwright/test";
import { insertPostDirect, resolveApiKey, runCleanupScript } from "./helpers";

const apiKey = resolveApiKey();

const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

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
      ).toBeVisible({ timeout: 4000 });
      return;
    } catch {
      await page.waitForTimeout(300);
    }
  }

  throw new Error("API Key authentication did not transition to editor mode");
}

test("write page creates a post and redirects to detail", async ({ page }) => {
  const seed = Date.now();
  const title = `UI-E2E-CREATE-${seed}`;

  await page.goto("/write", { waitUntil: "networkidle" });
  await authenticate(page);

  await expect(page.getByRole("heading", { name: "새 글 작성" })).toBeVisible();

  await page.getByLabel("제목").fill(title);
  await page.getByLabel("상태").selectOption("published");
  await page.getByLabel("태그 (콤마 구분)").fill("e2e, playwright");

  const editor = page.getByPlaceholder("마크다운 본문을 입력하세요");
  await editor.fill("## UI 테스트\n\n본문 내용");

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "e2e.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });

  await expect(editor).toContainText("![image](/uploads/");

  await page.getByRole("button", { name: "게시하기" }).click();

  await expect(page).toHaveURL(/\/posts\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("본문 내용")).toBeVisible();
  await expect(page.getByRole("link", { name: "#e2e" })).toBeVisible();
});

test("write page edits an existing post", async ({ page, request }) => {
  const seed = Date.now();
  const created = await insertPostDirect(request, {
    title: `UI-E2E-EDIT-BEFORE-${seed}`,
    content: "수정 전 본문",
    tags: ["before"],
    status: "published",
    sourceUrl: `https://step5.test/ui/edit/${seed}`,
  });

  const updatedTitle = `UI-E2E-EDIT-AFTER-${seed}`;

  await page.goto(`/write?id=${created.id}`, { waitUntil: "networkidle" });
  await authenticate(page);

  await expect(
    page.getByRole("heading", { name: `글 수정 #${created.id}` }),
  ).toBeVisible();
  await expect(page.getByLabel("제목")).toHaveValue(
    `UI-E2E-EDIT-BEFORE-${seed}`,
  );

  await page.getByLabel("제목").fill(updatedTitle);
  await page.getByLabel("태그 (콤마 구분)").fill("after, playwright");

  const editor = page.getByPlaceholder("마크다운 본문을 입력하세요");
  await editor.fill("## 수정 후\n\n업데이트된 본문");

  await page.getByRole("button", { name: "수정 내용 저장" }).click();

  await expect(page).toHaveURL(new RegExp(`/posts/${created.slug}$`));
  await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible();
  await expect(page.getByText("업데이트된 본문")).toBeVisible();
  await expect(page.getByRole("link", { name: "#after" })).toBeVisible();
});
