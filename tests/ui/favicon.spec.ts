import { expect, test, type APIRequestContext } from "@playwright/test";

function isDataUrl(href: string) {
  return href.startsWith("data:");
}

async function expectImageResponse(
  request: APIRequestContext,
  href: string,
): Promise<void> {
  const response = await request.get(href);
  expect(response.ok(), `${href} should return 200`).toBe(true);

  const contentType = response.headers()["content-type"] ?? "";
  if (href.endsWith(".png")) {
    expect(contentType, `${href} content-type should be image/png`).toContain(
      "image/png",
    );
  } else if (href.endsWith(".ico")) {
    expect(
      contentType,
      `${href} content-type should be an icon mime type`,
    ).toMatch(/image\/(x-icon|vnd\.microsoft\.icon)/);
  } else {
    expect(contentType, `${href} content-type should be an image`).toMatch(
      /^image\//,
    );
  }
}

test("icons links exist and resources are reachable", async ({
  page,
  request,
}) => {
  await page.goto("/wiki", { waitUntil: "networkidle" });

  const iconHrefs = await page
    .locator('head link[rel="icon"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("href"))
        .filter((value): value is string => Boolean(value)),
    );

  const appleHrefs = await page
    .locator('head link[rel="apple-touch-icon"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("href"))
        .filter((value): value is string => Boolean(value)),
    );

  expect(iconHrefs.length, "link[rel=icon] should exist").toBeGreaterThan(0);
  expect(
    appleHrefs.length,
    "link[rel=apple-touch-icon] should exist",
  ).toBeGreaterThan(0);

  const uniqueHrefs = new Set([...iconHrefs, ...appleHrefs, "/favicon.ico"]);
  for (const href of uniqueHrefs) {
    if (isDataUrl(href)) {
      continue;
    }
    await expectImageResponse(request, href);
  }
});
