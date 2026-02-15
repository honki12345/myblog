import { expect, test } from "@playwright/test";
import {
  authenticateWriteEditor,
  insertPostDirect,
  runCleanupScript,
} from "./helpers";

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

test("write page creates a post and redirects to detail", async ({ page }) => {
  const seed = Date.now();
  const title = `UI-E2E-CREATE-${seed}`;

  await page.goto("/write", { waitUntil: "networkidle" });
  await authenticateWriteEditor(page);

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

test("write page saves draft and redirects back to editor", async ({
  page,
}) => {
  const seed = Date.now();
  const title = `UI-E2E-DRAFT-${seed}`;

  await page.goto("/write", { waitUntil: "networkidle" });
  await authenticateWriteEditor(page);

  await page.getByLabel("제목").fill(title);
  await page.getByLabel("상태").selectOption("draft");
  await page.getByPlaceholder("마크다운 본문을 입력하세요").fill("초안 본문");
  await page.getByRole("button", { name: "초안 저장" }).click();

  await expect(page).toHaveURL(/\/write\?id=\d+$/, { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: /글 수정 #\d+/ }),
  ).toBeVisible();
  await expect(page.getByLabel("제목")).toHaveValue(title);
});

test("write page creates published post with Korean slug", async ({ page }) => {
  const seed = Date.now();
  const title = `UI-E2E-한글-${seed}`;

  await page.goto("/write", { waitUntil: "networkidle" });
  await authenticateWriteEditor(page);

  await page.getByLabel("제목").fill(title);
  await page.getByLabel("상태").selectOption("published");
  await page
    .getByPlaceholder("마크다운 본문을 입력하세요")
    .fill("한글 slug 상세 페이지 검증");
  await page.getByRole("button", { name: "게시하기" }).click();

  await expect(page).toHaveURL(/\/posts\//, { timeout: 20_000 });
  const currentPathname = new URL(page.url()).pathname;
  const encodedSlug = currentPathname.replace(/^\/posts\//, "");
  const decodedSlug = decodeURIComponent(encodedSlug);

  expect(decodedSlug).toContain("한글");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
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
  await authenticateWriteEditor(page);

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
