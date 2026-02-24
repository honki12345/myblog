import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  assertNoHorizontalPageScroll,
  authenticateAdminSession,
  insertPostDirect,
  resolveApiKey,
  runCleanupScript,
  waitForDocumentTitle,
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

async function expectMobileActionStackLayout(
  page: Page,
  projectName: string,
): Promise<void> {
  if (projectName !== "mobile-360") {
    return;
  }

  const layout = await page
    .locator("[data-post-admin-actions-list]")
    .evaluate((node) => {
      const actions = Array.from(
        node.querySelectorAll<HTMLElement>("[data-post-admin-action]"),
      ).map((item) => {
        const rect = item.getBoundingClientRect();
        return {
          action: item.dataset.postAdminAction ?? "",
          top: rect.top,
          left: rect.left,
        };
      });

      return {
        flexDirection: window.getComputedStyle(node).flexDirection,
        actions,
      };
    });

  expect(layout.flexDirection).toBe("column");
  expect(layout.actions.map((item) => item.action)).toEqual([
    "edit",
    "toggle-read",
    "delete",
  ]);

  const [editAction, toggleAction, deleteAction] = layout.actions;
  if (!editAction || !toggleAction || !deleteAction) {
    throw new Error("expected exactly three admin actions in mobile stack");
  }
  expect(toggleAction.top).toBeGreaterThan(editAction.top + 1);
  expect(deleteAction.top).toBeGreaterThan(toggleAction.top + 1);
  expect(Math.abs(toggleAction.left - editAction.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(deleteAction.left - toggleAction.left)).toBeLessThanOrEqual(
    1,
  );
}

test.beforeEach(() => {
  runCleanupScript();
});

test("non-admin post detail redirects to login", async ({ page, request }) => {
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
  await expect(page).toHaveURL(
    new RegExp(`/admin/login\\?next=%2Fposts%2F${created.slug}$`),
  );
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
  const postRoutePattern = `**/api/admin/posts/${created.id}`;
  let delayedPatchOnce = true;
  let delayedDeleteOnce = true;
  await page.route(postRoutePattern, async (route) => {
    const method = route.request().method();
    if (method === "PATCH" && delayedPatchOnce) {
      delayedPatchOnce = false;
      await page.waitForTimeout(250);
    } else if (method === "DELETE" && delayedDeleteOnce) {
      delayedDeleteOnce = false;
      await page.waitForTimeout(250);
    }

    await route.continue();
  });

  await expect(page.getByRole("heading", { name: seed.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "수정" })).toHaveAttribute(
    "href",
    new RegExp(`/admin/write\\?id=${created.id}$`),
  );
  await expect(page.getByRole("button", { name: "삭제" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "읽음으로 표시" }),
  ).toBeVisible();
  await expectMobileActionStackLayout(page, testInfo.project.name);
  await page.getByRole("button", { name: "읽음으로 표시" }).click();
  await expect(page.getByRole("button", { name: "변경 중…" })).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /posts/${created.slug} overflows while read toggle is pending`,
  );
  await expect(
    page.getByRole("button", { name: "읽지 않음으로 표시" }),
  ).toBeVisible();
  await expectMobileActionStackLayout(page, testInfo.project.name);
  await waitForDocumentTitle(page);
  await expect(page).toHaveTitle(
    new RegExp(seed.title.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")),
  );
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /posts/${created.slug} has horizontal overflow`,
  );

  const axeResults = await new AxeBuilder({ page }).analyze();
  const blockingViolations = axeResults.violations.filter((violation) => {
    return violation.impact === "critical" || violation.impact === "serious";
  });
  expect(blockingViolations).toEqual([]);

  await expect(page.locator("main")).toHaveScreenshot(
    "post-detail-admin-actions.png",
    {
      maxDiffPixelRatio: getAdminActionsDiffThreshold(testInfo.project.name),
    },
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByRole("button", { name: "삭제 중…" })).toBeVisible();
  await assertNoHorizontalPageScroll(
    page,
    `[${testInfo.project.name}] /posts/${created.slug} overflows while delete is pending`,
  );

  await expect(page).toHaveURL(/\/posts(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "글 목록" })).toBeVisible();
  await page.unroute(postRoutePattern);

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
