import { expect, test } from "@playwright/test";
import { runCleanupScript } from "./helpers";

test("home: empty state 안내문에서 아카이브 링크 언급이 제거된다", async ({
  page,
}) => {
  runCleanupScript();

  await page.goto("/", { waitUntil: "networkidle" });

  await expect(
    page.getByText(
      /아직 글이 없습니다\.\s*상단 메뉴\(글 목록\/태그\)에서 탐색을 시작해 보세요\./,
    ),
  ).toBeVisible();
  await expect(page.getByText("아카이브 링크")).toHaveCount(0);
});

