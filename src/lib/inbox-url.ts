export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type NormalizeXStatusUrlOptions = {
  fetch?: FetchLike;
  maxRedirects?: number;
  timeoutMs?: number;
};

const ALLOWED_HOSTS = new Set(["x.com", "twitter.com", "t.co"]);

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function assertSafeUrl(url: URL, context: string): void {
  if (url.protocol !== "https:") {
    throw new Error(`${context}: only https URLs are allowed`);
  }

  if (url.username || url.password) {
    throw new Error(`${context}: URL must not include credentials`);
  }

  if (url.port && url.port !== "443") {
    throw new Error(`${context}: URL must not include a non-default port`);
  }

  const host = normalizeHost(url.hostname);
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`${context}: host is not allowed`);
  }
}

function extractStatusId(url: URL): string | null {
  const pathname = url.pathname.replace(/\/+$/, "");
  const match =
    pathname.match(/^\/i\/web\/status\/(\d+)$/) ??
    pathname.match(/^\/status\/(\d+)$/) ??
    pathname.match(/^\/[^/]+\/status\/(\d+)$/);
  return match?.[1] ?? null;
}

async function fetchWithTimeout(
  fetchFn: FetchLike,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchFn(input, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRedirectResponse(
  fetchFn: FetchLike,
  url: URL,
  timeoutMs: number,
): Promise<Response> {
  const head = await fetchWithTimeout(
    fetchFn,
    url.toString(),
    { method: "HEAD" },
    timeoutMs,
  );

  if (head.status !== 405 && head.status !== 501) {
    return head;
  }

  return fetchWithTimeout(
    fetchFn,
    url.toString(),
    { method: "GET" },
    timeoutMs,
  );
}

async function resolveRedirects(
  startUrl: URL,
  options: Required<Pick<NormalizeXStatusUrlOptions, "fetch" | "timeoutMs">> & {
    maxRedirects: number;
  },
): Promise<URL> {
  let current = startUrl;
  const visited = new Set<string>();

  for (
    let redirectCount = 0;
    redirectCount <= options.maxRedirects;
    redirectCount += 1
  ) {
    const key = current.toString();
    if (visited.has(key)) {
      throw new Error("redirect loop detected");
    }
    visited.add(key);

    const response = await fetchRedirectResponse(
      options.fetch,
      current,
      options.timeoutMs,
    );

    if (!isRedirectStatus(response.status)) {
      return current;
    }

    if (redirectCount === options.maxRedirects) {
      throw new Error("too many redirects");
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("redirect missing location header");
    }

    const next = new URL(location, current);
    assertSafeUrl(next, "redirect target");
    current = next;
  }

  return current;
}

export async function normalizeXStatusUrl(
  input: string,
  options: NormalizeXStatusUrlOptions = {},
): Promise<{ canonicalUrl: string; statusId: string }> {
  if (typeof input !== "string") {
    throw new Error("url must be a string");
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("url must not be empty");
  }

  if (trimmed.length > 2048) {
    throw new Error("url must be 2048 characters or fewer");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("url must be a valid URL");
  }

  assertSafeUrl(url, "input url");

  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxRedirects = options.maxRedirects ?? 5;

  const host = normalizeHost(url.hostname);
  if (host === "t.co") {
    url = await resolveRedirects(url, {
      fetch: fetchFn,
      timeoutMs,
      maxRedirects,
    });
  }

  const finalHost = normalizeHost(url.hostname);
  if (finalHost !== "x.com" && finalHost !== "twitter.com") {
    throw new Error("resolved URL must point to x.com or twitter.com");
  }

  const statusId = extractStatusId(url);
  if (!statusId) {
    throw new Error("url must be a valid X status URL");
  }

  return {
    canonicalUrl: `https://x.com/i/web/status/${statusId}`,
    statusId,
  };
}
