import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  authenticateAdminSession,
  insertPostDirect,
  resolveApiKey,
  runCleanupScript,
  type SeededPost,
} from "./helpers";

function getAdminActionsDiffThreshold(projectName: string): number {
  // CI 러너 폰트 메트릭 차이로 줄바꿈/안티앨리어싱 오차가 발생할 수 있어
  // 뷰포트별 허용치를 둔다.
  if (projectName === "mobile-360") {
    return 0.03;
  }
  if (projectName === "tablet-768") {
    return 0.04;
  }
  return 0.03;
}

const DISABLE_ANIMATION_STYLE = `
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

async function triggerRevalidationForSeededPost(
  request: APIRequestContext,
  post: SeededPost & { id: number },
): Promise<void> {
  const apiKey = resolveApiKey();
  const response = await request.patch(`/api/posts/${post.id}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    data: {
      title: post.title,
      content: post.content,
      status: post.status,
      tags: post.tags,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `failed to trigger route revalidation: ${response.status()} ${await response.text()}`,
    );
  }
}

test.beforeEach(() => {
  runCleanupScript();
});

test("public post detail hides admin edit/delete actions", async ({
  page,
  request,
}) => {
  const seed: SeededPost = {
    title: "PW-SEED-ADMIN-ACTIONS",
    content: "## 관리자 액션 테스트\n\n공개 글 상세 페이지 테스트",
    tags: ["playwright", "admin"],
    status: "published",
    sourceUrl: "https://playwright.seed/admin-actions",
  };

  const created = await insertPostDirect(request, seed);
  await triggerRevalidationForSeededPost(request, { ...seed, id: created.id });

  await page.goto(`/posts/${created.slug}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: seed.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "수정" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "삭제" })).toHaveCount(0);
});

test("admin can see edit/delete actions on public detail and delete post", async ({
  page,
  request,
}, testInfo) => {
  const seed: SeededPost = {
    title: "PW-SEED-ADMIN-ACTIONS",
    content: "## 관리자 액션 테스트\n\n삭제 동작 확인",
    tags: ["playwright", "admin"],
    status: "published",
    sourceUrl: "https://playwright.seed/admin-actions",
  };

  const created = await insertPostDirect(request, seed);
  await triggerRevalidationForSeededPost(request, { ...seed, id: created.id });

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await authenticateAdminSession(page, { nextPath: `/posts/${created.slug}` });
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: DISABLE_ANIMATION_STYLE });

  await expect(page.getByRole("heading", { name: seed.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "수정" })).toHaveAttribute(
    "href",
    new RegExp(`/admin/write\\?id=${created.id}$`),
  );
  await expect(page.getByRole("button", { name: "삭제" })).toBeVisible();
  await expect(page.locator("main")).toHaveScreenshot(
    "post-detail-admin-actions.png",
    {
      maxDiffPixelRatio: getAdminActionsDiffThreshold(testInfo.project.name),
    },
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "삭제" }).click();

  await expect(page).toHaveURL(/\/posts(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "글 목록" })).toBeVisible();

  const response = await page.goto(`/posts/${created.slug}`, {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(404);
});

test("admin delete api rejects requests without csrf header", async ({
  page,
  request,
}) => {
  const seed: SeededPost = {
    title: "PW-SEED-ADMIN-ACTIONS",
    content: "## 관리자 액션 테스트\n\nCSRF 검증",
    tags: ["playwright", "admin"],
    status: "published",
    sourceUrl: "https://playwright.seed/admin-actions",
  };

  const created = await insertPostDirect(request, seed);
  await triggerRevalidationForSeededPost(request, { ...seed, id: created.id });

  await authenticateAdminSession(page, { nextPath: `/posts/${created.slug}` });
  await page.waitForLoadState("networkidle");

  const cookieMap = new Map(
    (await page.context().cookies()).map((cookie) => [
      cookie.name,
      cookie.value,
    ]),
  );
  const cookieHeader = [
    ["admin_session", cookieMap.get("admin_session")],
    ["admin_csrf", cookieMap.get("admin_csrf")],
  ]
    .filter((pair): pair is [string, string] => Boolean(pair[1]))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  expect(cookieHeader).toContain("admin_session=");
  expect(cookieHeader).toContain("admin_csrf=");

  const response = await request.delete(`/api/admin/posts/${created.id}`, {
    headers: {
      Cookie: cookieHeader,
    },
  });
  expect(response.status()).toBe(403);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("CSRF_FAILED");
});
