import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import {
  PLAYWRIGHT_DATABASE_PATH,
  generateTotpCode,
  resolveAdminPassword,
  resolveAdminTotpSecret,
  resolveAdminUsername,
  runCleanupScript,
} from "./helpers";

const DISABLE_ANIMATION_STYLE = `
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

function getDiffThreshold(projectName: string): number {
  // CI runners sometimes render fonts slightly differently on admin pages.
  if (projectName === "mobile-360") {
    return 0.05;
  }
  if (projectName === "tablet-768") {
    return 0.04;
  }
  return 0.01;
}

async function assertNoSeriousA11yViolations(page: Page, message: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });
  expect(blocking, message).toEqual([]);
}

function resetAdminTotpEnabledAt(): void {
  const db = new Database(PLAYWRIGHT_DATABASE_PATH);
  try {
    db.prepare(
      "UPDATE admin_auth SET totp_enabled_at = NULL WHERE id = 1",
    ).run();
  } catch {
    // Best-effort: the server applies migrations on startup, but keep tests resilient.
  } finally {
    db.close();
  }
}

function findCookieValue(
  cookies: Array<{ name: string; value: string }>,
  name: string,
): string | null {
  const match = cookies.find((cookie) => cookie.name === name);
  if (!match?.value) {
    return null;
  }
  return match.value;
}

test.beforeEach(() => {
  runCleanupScript();
  resetAdminTotpEnabledAt();
});

test("admin 2FA setup QR is locked after enabling", async ({
  page,
}, testInfo) => {
  const maxDiffPixelRatio = getDiffThreshold(testInfo.project.name);
  const username = resolveAdminUsername();
  const password = resolveAdminPassword();
  const totpSecret = resolveAdminTotpSecret();
  const nextPath = "/admin/write";

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

  await page.goto(`/admin/login?next=${encodeURIComponent(nextPath)}`, {
    waitUntil: "networkidle",
  });
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await page.getByLabel("아이디").fill(username);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "1차 인증" }).click();
  await expect(page.getByLabel("인증 코드")).toBeVisible({ timeout: 8_000 });

  const cookiesAfterPrimary = await page.context().cookies();
  expect(
    findCookieValue(cookiesAfterPrimary, "admin_login_challenge"),
  ).not.toBe(null);
  expect(findCookieValue(cookiesAfterPrimary, "admin_session")).toBe(null);

  await expect(
    page.getByRole("button", { name: "Authenticator 등록 QR 보기" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Authenticator 등록 QR 보기" })
    .click();
  await expect(page.getByAltText("Authenticator 앱 등록 QR 코드")).toBeVisible({
    timeout: 10_000,
  });

  let authenticated = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateTotpCode(totpSecret);
    await page.getByLabel("인증 코드").fill(code);
    await page.getByRole("button", { name: "2차 인증 완료" }).click();

    try {
      await expect(page).toHaveURL(
        new RegExp(nextPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        { timeout: 10_000 },
      );
      authenticated = true;
      break;
    } catch {
      await page.waitForTimeout(500);
    }
  }

  if (!authenticated) {
    throw new Error("admin authentication did not transition to workspace");
  }

  const cookiesAfterVerify = await page.context().cookies();
  expect(findCookieValue(cookiesAfterVerify, "admin_login_challenge")).toBe(
    null,
  );
  expect(findCookieValue(cookiesAfterVerify, "admin_session")).not.toBe(null);

  const dbAfterVerify = new Database(PLAYWRIGHT_DATABASE_PATH);
  try {
    const row = dbAfterVerify
      .prepare("SELECT totp_enabled_at FROM admin_auth WHERE id = 1 LIMIT 1")
      .get() as { totp_enabled_at: string | null } | undefined;
    expect(row?.totp_enabled_at).not.toBe(null);
  } finally {
    dbAfterVerify.close();
  }

  // Avoid flakiness from logout API/cookie clearing: we only need a "fresh login"
  // state for the second attempt.
  await page.context().clearCookies();
  await page.goto(`/admin/login?next=${encodeURIComponent(nextPath)}`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: "관리자 로그인" }),
  ).toBeVisible();
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await page.getByLabel("아이디").fill(username);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "1차 인증" }).click();
  await expect(page.getByLabel("인증 코드")).toBeVisible({ timeout: 8_000 });

  const cookiesAfterPrimaryAgain = await page.context().cookies();
  expect(
    findCookieValue(cookiesAfterPrimaryAgain, "admin_login_challenge"),
  ).not.toBe(null);
  expect(findCookieValue(cookiesAfterPrimaryAgain, "admin_session")).toBe(null);

  await expect(
    page.getByRole("button", { name: "Authenticator 등록 QR 보기" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("이미 2FA가 활성화되어 있어 QR을 다시 표시할 수 없습니다."),
  ).toBeVisible();

  const setupAfterEnabled = await page.evaluate(async () => {
    const response = await fetch("/api/admin/auth/totp-setup", {
      method: "GET",
      credentials: "same-origin",
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  });
  expect(setupAfterEnabled.status).toBe(409);
  expect(setupAfterEnabled.json?.error?.code).toBe("TOTP_ALREADY_ENABLED");

  await assertNoSeriousA11yViolations(
    page,
    `[${testInfo.project.name}] admin verify stage has serious/critical accessibility violations`,
  );
  await expect(page).toHaveScreenshot("admin-2fa-setup-locked.png", {
    maxDiffPixelRatio,
  });
});
