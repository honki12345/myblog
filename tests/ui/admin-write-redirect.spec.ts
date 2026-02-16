import { expect, test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3000";

test("write compatibility route redirects to admin write", async () => {
  const response = await fetch(`${BASE_URL}/write`);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("관리자 로그인");
  expect(html).toContain("/admin/write");
});

test("write?id compatibility route preserves query on redirect", async () => {
  const response = await fetch(`${BASE_URL}/write?id=123`);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("관리자 로그인");
  expect(html).toContain("/admin/write?id=123");
});
