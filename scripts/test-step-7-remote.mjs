import process from "node:process";

const REQUEST_TIMEOUT_MS = 20_000;
const HEALTH_RETRIES = 8;
const HEALTH_DELAY_MS = 3_000;
const PAGE_RETRIES = 8;
const PAGE_DELAY_MS = 1_500;
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const DB_BLOCKED_STATUSES = new Set([403, 404]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDomain(rawDomain) {
  const trimmed = rawDomain.trim();
  const normalized =
    /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(normalized);
  assert(parsed.hostname.length > 0, `invalid BLOG_DOMAIN: ${rawDomain}`);

  return {
    host: parsed.host,
    httpsBase: `https://${parsed.host}`,
    httpBase: `http://${parsed.host}`,
  };
}

function resolveApiKey() {
  const apiKeyFromEnv = process.env.API_KEY?.trim();
  if (apiKeyFromEnv) {
    return { value: apiKeyFromEnv, source: "API_KEY" };
  }

  const apiKeyFallback = process.env.BLOG_API_KEY?.trim();
  if (apiKeyFallback) {
    return { value: apiKeyFallback, source: "BLOG_API_KEY" };
  }

  throw new Error("API_KEY is required (fallback: BLOG_API_KEY)");
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`expected JSON response but received: ${text.slice(0, 200)}`);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const data = await parseJsonResponse(response);
  return { status: response.status, headers: response.headers, data };
}

async function waitForHealth(baseUrl) {
  const target = `${baseUrl}/api/health`;
  let lastError = null;

  for (let attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1) {
    try {
      const response = await requestJson(target);
      if (response.status === 200 && response.data?.status === "ok") {
        return response;
      }
      lastError = new Error(
        `health check returned status=${response.status}, body=${JSON.stringify(response.data)}`,
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < HEALTH_RETRIES) {
      await sleep(HEALTH_DELAY_MS);
    }
  }

  throw new Error(
    `health check failed after ${HEALTH_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function waitForHtmlContains(url, needle) {
  let lastHtml = "";
  for (let attempt = 1; attempt <= PAGE_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(url, {
      headers: { "user-agent": "step7-remote-check" },
    });
    const html = await response.text();

    if (response.status === 200 && html.includes(needle)) {
      return;
    }

    lastHtml = html;
    if (attempt < PAGE_RETRIES) {
      await sleep(PAGE_DELAY_MS);
    }
  }

  throw new Error(
    `page did not include expected content after retries: ${needle}\nlast response preview: ${lastHtml.slice(0, 200)}`,
  );
}

function authHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function testHttpsAndHsts(httpsBase) {
  console.log("\n[1/7] HTTPS and HSTS");
  const response = await fetchWithTimeout(`${httpsBase}/`, {
    headers: { "user-agent": "step7-remote-check" },
  });
  assert(response.status === 200, `GET / must return 200, received ${response.status}`);

  const hsts = response.headers.get("strict-transport-security");
  assert(hsts, "Strict-Transport-Security header must be present");
  assert(
    /max-age=31536000/i.test(hsts),
    `Strict-Transport-Security max-age must include 31536000, received: ${hsts}`,
  );
  console.log("HTTPS + HSTS PASSED");
}

async function testHttpToHttpsRedirect(httpBase) {
  console.log("\n[2/7] HTTP -> HTTPS redirect");
  const response = await fetchWithTimeout(`${httpBase}/`, {
    redirect: "manual",
    headers: { "user-agent": "step7-remote-check" },
  });

  assert(
    REDIRECT_STATUSES.has(response.status),
    `http root must redirect (301/302/307/308), received ${response.status}`,
  );
  const location = response.headers.get("location") ?? "";
  assert(
    location.startsWith("https://"),
    `redirect location must start with https://, received: ${location}`,
  );
  console.log("HTTP REDIRECT PASSED");
}

async function testApiAuthAndCreatePost(httpsBase, apiKey) {
  console.log("\n[3/7] API auth and create");
  const unauthorized = await requestJson(`${httpsBase}/api/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "unauthorized test",
      content: "unauthorized test",
    }),
  });
  assert(
    unauthorized.status === 401,
    `unauthorized POST /api/posts must return 401, received ${unauthorized.status}`,
  );
  assert(
    unauthorized.data?.error?.code === "UNAUTHORIZED",
    `unauthorized response code must be UNAUTHORIZED, received ${unauthorized.data?.error?.code}`,
  );

  const seed = Date.now();
  const title = `프로덕션 E2E 테스트 ${seed}`;
  const sourceUrl = `https://example.com/prod-e2e-${seed}`;
  const createResponse = await requestJson(`${httpsBase}/api/posts`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      title,
      content: "## 테스트\n\n```python\nprint(\"hello\")\n```\n\n$E=mc^2$",
      tags: ["e2e", "production"],
      sourceUrl,
      status: "published",
    }),
  });

  assert(
    createResponse.status === 201,
    `authorized POST /api/posts must return 201, received ${createResponse.status}`,
  );
  assert(
    typeof createResponse.data?.id === "number",
    "create response must include numeric id",
  );
  assert(
    typeof createResponse.data?.slug === "string" &&
      createResponse.data.slug.length > 0,
    "create response must include slug",
  );

  console.log("API AUTH + CREATE PASSED");
  return {
    id: createResponse.data.id,
    slug: createResponse.data.slug,
    title,
    sourceUrl,
  };
}

async function testPageAccess(httpsBase, title) {
  console.log("\n[4/7] page access");
  const home = await fetchWithTimeout(`${httpsBase}/`, {
    headers: { "user-agent": "step7-remote-check" },
  });
  assert(home.status === 200, `GET / must return 200, received ${home.status}`);

  const posts = await fetchWithTimeout(`${httpsBase}/posts`, {
    headers: { "user-agent": "step7-remote-check" },
  });
  assert(posts.status === 200, `GET /posts must return 200, received ${posts.status}`);

  await waitForHtmlContains(`${httpsBase}/`, title);
  console.log("PAGE ACCESS PASSED");
}

async function testDbFileBlocking(httpsBase) {
  console.log("\n[5/7] SQLite file blocking");
  const paths = ["/data/blog.db", "/blog.db"];
  for (const blockedPath of paths) {
    const response = await fetchWithTimeout(`${httpsBase}${blockedPath}`, {
      headers: { "user-agent": "step7-remote-check" },
    });
    assert(
      DB_BLOCKED_STATUSES.has(response.status),
      `${blockedPath} must return 403 or 404, received ${response.status}`,
    );
  }
  console.log("SQLITE FILE BLOCKING PASSED");
}

async function testE2eScenario(httpsBase, apiKey, createdPost) {
  console.log("\n[6/7] remote E2E scenario");
  const detail = await fetchWithTimeout(`${httpsBase}/posts/${createdPost.slug}`, {
    headers: { "user-agent": "step7-remote-check" },
  });
  const detailHtml = await detail.text();
  assert(
    detail.status === 200,
    `GET /posts/${createdPost.slug} must return 200, received ${detail.status}`,
  );
  assert(
    detailHtml.includes(createdPost.title),
    "detail page must include created post title",
  );
  assert(detailHtml.includes("<pre"), "detail page must include rendered code block");

  const check = await requestJson(
    `${httpsBase}/api/posts/check?url=${encodeURIComponent(createdPost.sourceUrl)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );
  assert(
    check.status === 200,
    `GET /api/posts/check must return 200, received ${check.status}`,
  );
  assert(check.data?.exists === true, "source URL check must return exists=true");

  const patch = await requestJson(`${httpsBase}/api/posts/${createdPost.id}`, {
    method: "PATCH",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ status: "draft" }),
  });
  assert(
    patch.status === 200,
    `PATCH /api/posts/${createdPost.id} must return 200, received ${patch.status}`,
  );

  console.log("REMOTE E2E PASSED");
}

async function testHealthEndpoint(httpsBase) {
  console.log("\n[7/7] health endpoint");
  const health = await waitForHealth(httpsBase);
  assert(
    health.data?.db === "connected",
    `health response db must be connected, received: ${health.data?.db}`,
  );
  console.log("HEALTH CHECK PASSED");
}

async function main() {
  const rawDomain = process.env.BLOG_DOMAIN;
  assert(rawDomain && rawDomain.trim(), "BLOG_DOMAIN is required");

  const { host, httpsBase, httpBase } = parseDomain(rawDomain);
  const apiKey = resolveApiKey();

  console.log(`target host: ${host}`);
  console.log(`api key source: ${apiKey.source}`);

  await testHealthEndpoint(httpsBase);
  await testHttpsAndHsts(httpsBase);
  await testHttpToHttpsRedirect(httpBase);
  const createdPost = await testApiAuthAndCreatePost(httpsBase, apiKey.value);
  await testPageAccess(httpsBase, createdPost.title);
  await testDbFileBlocking(httpsBase);
  await testE2eScenario(httpsBase, apiKey.value, createdPost);

  console.log("\nSTEP 7 REMOTE TEST PASSED");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nSTEP 7 REMOTE TEST FAILED: ${message}`);
  process.exitCode = 1;
});
