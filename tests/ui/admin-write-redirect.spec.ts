import { expect, test } from "@playwright/test";

test("write compatibility route redirects to admin write", async ({ page }) => {
  await page.goto("/write", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fwrite$/);
  await expect(
    page.getByRole("heading", { name: "관리자 로그인" }),
  ).toBeVisible();
});

test("write?id compatibility route preserves query on redirect", async ({
  page,
}) => {
  await page.goto("/write?id=123", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(
    /\/admin\/login\?next=%2Fadmin%2Fwrite%3Fid%3D123$/,
  );
  await expect(
    page.getByRole("heading", { name: "관리자 로그인" }),
  ).toBeVisible();
});
