import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticateAdminSession, runCleanupScript } from "./helpers";

function getVisualDiffThreshold(projectName: string): number {
  if (projectName === "mobile-360") {
    return 0.06;
  }
  if (projectName === "tablet-768") {
    return 0.03;
  }
  if (projectName === "desktop-1440") {
    return 0.02;
  }
  return 0.01;
}

function buildTestIp(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  const last = digest[0] ?? 1;
  const octet = Math.min(254, Math.max(1, last));
  return `203.0.113.${octet}`;
}

test.beforeEach(async ({ page }, testInfo) => {
  runCleanupScript();
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": buildTestIp(`${testInfo.project.name}:${testInfo.title}`),
  });
});

test("guest thread stays private and admin can reply", async (
  { page, browser },
  testInfo,
) => {
  const baseURL = testInfo.project.use.baseURL as string;

  await page.goto("/guestbook", { waitUntil: "networkidle" });

  const createForm = page.getByTestId("guestbook-create-form");
  await createForm.getByLabel("아이디").fill("playwright_guest");
  await createForm.getByLabel("비밀번호").fill("guest-password-1234");
  await createForm.getByLabel("메시지").fill("안녕하세요. 첫 메시지입니다.");
  await createForm.getByRole("button", { name: "스레드 만들고 보내기" }).click();

  const messageList = page.getByTestId("guestbook-message-list");
  await expect(messageList).toContainText("안녕하세요. 첫 메시지입니다.");

  const messageForm = page.getByTestId("guestbook-message-form");
  await messageForm.getByLabel("새 메시지").fill("추가 메시지입니다.");
  await messageForm.getByRole("button", { name: "보내기" }).click();
  await expect(messageList).toContainText("추가 메시지입니다.");

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "guestbook_session");
  expect(sessionCookie, "guestbook_session cookie should exist").toBeTruthy();
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Lax");

  // Playwright APIRequestContext does not reliably reuse browser cookies across all environments.
  // Pass the session cookie explicitly so this assertion matches real browser behavior.
  const threadResponse = await page.request.get("/api/guestbook/thread", {
    headers: {
      Cookie: `guestbook_session=${sessionCookie?.value ?? ""}`,
    },
  });
  expect(threadResponse.ok()).toBe(true);
  expect(threadResponse.headers()["x-robots-tag"]).toContain("noindex");

  const otherContext = await browser.newContext({
    baseURL,
    extraHTTPHeaders: {
      "x-forwarded-for": buildTestIp(
        `other:${testInfo.project.name}:${testInfo.title}`,
      ),
    },
  });
  const otherThreadResponse = await otherContext.request.get("/api/guestbook/thread");
  expect(otherThreadResponse.status()).toBe(401);

  const otherPage = await otherContext.newPage();
  await otherPage.goto("/guestbook", { waitUntil: "networkidle" });
  await expect(otherPage.getByTestId("guestbook-create-form")).toBeVisible();
  await expect(otherPage.getByText("안녕하세요. 첫 메시지입니다.")).toHaveCount(0);

  await otherPage.goto("/admin/guestbook", { waitUntil: "networkidle" });
  const redirected = new URL(otherPage.url());
  expect(redirected.pathname).toBe("/admin/login");

  await otherContext.close();

  const adminContext = await browser.newContext({
    baseURL,
    extraHTTPHeaders: {
      "x-forwarded-for": buildTestIp(
        `admin:${testInfo.project.name}:${testInfo.title}`,
      ),
    },
  });
  const adminPage = await adminContext.newPage();
  await authenticateAdminSession(adminPage, { nextPath: "/admin/guestbook" });

  const threadItems = adminPage.getByTestId("admin-guestbook-thread-item");
  await expect(threadItems.first()).toBeVisible();
  await threadItems.first().click();

  await expect(adminPage).toHaveURL(/\/admin\/guestbook\/\d+$/);
  const threadId = new URL(adminPage.url()).pathname.split("/").pop();
  expect(threadId).toBeTruthy();

  const adminCookies = await adminContext.cookies();
  const adminSessionCookie = adminCookies.find((cookie) => cookie.name === "admin_session");
  expect(adminSessionCookie, "admin_session cookie should exist").toBeTruthy();

  const csrfMissing = await adminContext.request.post(
    `/api/admin/guestbook/threads/${threadId}/messages`,
    {
      data: { content: "csrf-missing" },
      headers: {
        Cookie: `admin_session=${adminSessionCookie?.value ?? ""}`,
      },
    },
  );
  expect(csrfMissing.status()).toBe(403);
  const csrfMissingBody = (await csrfMissing.json()) as {
    error?: { code?: string };
  };
  expect(csrfMissingBody.error?.code).toBe("CSRF_FAILED");

  const replyForm = adminPage.getByTestId("admin-guestbook-reply-form");
  await replyForm.getByLabel("답장").fill("관리자 답장입니다.");
  await replyForm.getByRole("button", { name: "보내기" }).click();
  await expect(adminPage.getByText("관리자 답장입니다.")).toBeVisible();

  await adminContext.close();

  await page.reload({ waitUntil: "networkidle" });
  await expect(messageList).toContainText("관리자 답장입니다.");

  const maxDiffPixelRatio = getVisualDiffThreshold(testInfo.project.name);
  await expect(page).toHaveScreenshot("guestbook-thread.png", {
    fullPage: false,
    maxDiffPixelRatio,
  });
});
