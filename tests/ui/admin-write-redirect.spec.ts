import { expect, test } from "@playwright/test";

test("write compatibility route redirects to admin write", async ({
  request,
}) => {
  const response = await request.get("/write");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("관리자 로그인");
  expect(html).toContain("/admin/write");
});

test("write?id compatibility route preserves query on redirect", async ({
  request,
}) => {
  const response = await request.get("/write?id=123");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("관리자 로그인");
  expect(html).toContain("/admin/write?id=123");
});
