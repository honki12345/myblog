import { expect, test, type TestInfo } from "@playwright/test";

function resolveBaseUrl(testInfo: TestInfo) {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL || typeof baseURL !== "string") {
    throw new Error("Playwright baseURL is missing");
  }
  return baseURL;
}

test("write compatibility route redirects to admin write", async ({}, testInfo) => {
  const baseURL = resolveBaseUrl(testInfo);
  const response = await fetch(new URL("/write", baseURL));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("관리자 로그인");
  expect(html).toContain("/admin/write");
});

test("write?id compatibility route preserves query on redirect", async ({}, testInfo) => {
  const baseURL = resolveBaseUrl(testInfo);
  const response = await fetch(new URL("/write?id=123", baseURL));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("관리자 로그인");
  expect(html).toContain("/admin/write?id=123");
});
