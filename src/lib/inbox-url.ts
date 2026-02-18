import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type NormalizeXStatusUrlOptions = {
  fetch?: FetchLike;
  maxRedirects?: number;
  timeoutMs?: number;
};

export type ResolveHostnameLike = (hostname: string) => Promise<string[]>;

export type NormalizeDocUrlOptions = {
  fetch?: FetchLike;
  maxRedirects?: number;
  timeoutMs?: number;
  resolveHostname?: ResolveHostnameLike;
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

type Ipv4CidrRule = {
  base: number;
  mask: number;
  prefix: number;
};

type Ipv6CidrRule = {
  base: Uint8Array;
  prefix: number;
};

function parseIpv4ToBytes(input: string): Uint8Array | null {
  const parts = input.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const bytes = new Uint8Array(4);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part || !/^\d{1,3}$/.test(part)) {
      return null;
    }

    const byte = Number(part);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      return null;
    }

    bytes[index] = byte;
  }

  return bytes;
}

function ipv4BytesToUint32(bytes: Uint8Array, offset = 0): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function parseIpv4ToUint32(input: string): number | null {
  const bytes = parseIpv4ToBytes(input);
  if (!bytes) {
    return null;
  }

  return ipv4BytesToUint32(bytes);
}

function splitIpv6Hextets(part: string): string[] | null {
  if (part === "") {
    return [];
  }

  const pieces = part.split(":");
  if (pieces.some((piece) => piece.length === 0)) {
    return null;
  }

  return pieces;
}

function parseIpv6ToBytes(input: string): Uint8Array | null {
  const withoutZoneId = input.split("%")[0] ?? input;
  if (withoutZoneId.length === 0) {
    return null;
  }

  let normalized = withoutZoneId;
  if (normalized.includes(".")) {
    const lastColonIndex = normalized.lastIndexOf(":");
    if (lastColonIndex === -1) {
      return null;
    }

    const ipv4Part = normalized.slice(lastColonIndex + 1);
    const ipv4Bytes = parseIpv4ToBytes(ipv4Part);
    if (!ipv4Bytes) {
      return null;
    }

    const high = ((ipv4Bytes[0] ?? 0) << 8) | (ipv4Bytes[1] ?? 0);
    const low = ((ipv4Bytes[2] ?? 0) << 8) | (ipv4Bytes[3] ?? 0);
    normalized =
      normalized.slice(0, lastColonIndex) +
      `:${high.toString(16)}:${low.toString(16)}`;
  }

  const doubleColonSplit = normalized.split("::");
  if (doubleColonSplit.length > 2) {
    return null;
  }

  const leftHextets = splitIpv6Hextets(doubleColonSplit[0] ?? "");
  if (leftHextets === null) {
    return null;
  }

  let hextets: string[];
  if (doubleColonSplit.length === 1) {
    if (leftHextets.length !== 8) {
      return null;
    }
    hextets = leftHextets;
  } else {
    const rightHextets = splitIpv6Hextets(doubleColonSplit[1] ?? "");
    if (rightHextets === null) {
      return null;
    }

    const missing = 8 - (leftHextets.length + rightHextets.length);
    if (missing <= 0) {
      return null;
    }

    hextets = [
      ...leftHextets,
      ...Array.from({ length: missing }, () => "0"),
      ...rightHextets,
    ];
    if (hextets.length !== 8) {
      return null;
    }
  }

  const bytes = new Uint8Array(16);
  for (let index = 0; index < hextets.length; index += 1) {
    const hextet = hextets[index];
    if (!hextet || !/^[\da-fA-F]{1,4}$/.test(hextet)) {
      return null;
    }
    const parsed = Number.parseInt(hextet, 16);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) {
      return null;
    }

    bytes[index * 2] = (parsed >> 8) & 0xff;
    bytes[index * 2 + 1] = parsed & 0xff;
  }

  return bytes;
}

function ipv4MaskFromPrefix(prefix: number): number {
  if (prefix <= 0) {
    return 0;
  }
  if (prefix >= 32) {
    return 0xffffffff;
  }

  return (0xffffffff << (32 - prefix)) >>> 0;
}

function parseIpv4CidrRule(input: string): Ipv4CidrRule {
  const [baseRaw, prefixRaw] = input.split("/");
  if (!baseRaw || !prefixRaw) {
    throw new Error(`invalid CIDR rule: ${input}`);
  }

  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid CIDR prefix: ${input}`);
  }

  const baseValue = parseIpv4ToUint32(baseRaw);
  if (baseValue === null) {
    throw new Error(`invalid CIDR base: ${input}`);
  }

  const mask = ipv4MaskFromPrefix(prefix);
  return {
    base: baseValue & mask,
    mask,
    prefix,
  };
}

function parseIpv6CidrRule(input: string): Ipv6CidrRule {
  const [baseRaw, prefixRaw] = input.split("/");
  if (!baseRaw || !prefixRaw) {
    throw new Error(`invalid CIDR rule: ${input}`);
  }

  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
    throw new Error(`invalid CIDR prefix: ${input}`);
  }

  const baseBytes = parseIpv6ToBytes(baseRaw);
  if (!baseBytes) {
    throw new Error(`invalid CIDR base: ${input}`);
  }

  return {
    base: baseBytes,
    prefix,
  };
}

function isInIpv6Cidr(value: Uint8Array, rule: Ipv6CidrRule): boolean {
  if (rule.prefix <= 0) {
    return true;
  }

  const fullBytes = Math.floor(rule.prefix / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (value[index] !== rule.base[index]) {
      return false;
    }
  }

  const remainingBits = rule.prefix % 8;
  if (remainingBits === 0) {
    return true;
  }

  const mask = ((0xff << (8 - remainingBits)) & 0xff) >>> 0;
  return (
    ((value[fullBytes] ?? 0) & mask) === ((rule.base[fullBytes] ?? 0) & mask)
  );
}

function isIpv6V4Mapped(bytes: Uint8Array): boolean {
  for (let index = 0; index < 10; index += 1) {
    if (bytes[index] !== 0) {
      return false;
    }
  }

  return bytes[10] === 0xff && bytes[11] === 0xff;
}

const BLOCKED_IPV4_CIDRS: Ipv4CidrRule[] = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "192.88.99.0/24",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
].map(parseIpv4CidrRule);

const BLOCKED_IPV6_CIDRS: Ipv6CidrRule[] = [
  "::/128",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
  "2001:db8::/32",
].map(parseIpv6CidrRule);

function isBlockedResolvedIp(input: string): boolean {
  const withoutZoneId = input.split("%")[0] ?? input;
  const kind = isIP(withoutZoneId);

  if (kind === 4) {
    const ipv4Value = parseIpv4ToUint32(withoutZoneId);
    if (ipv4Value === null) {
      return true;
    }

    return BLOCKED_IPV4_CIDRS.some(
      (rule) => (ipv4Value & rule.mask) === rule.base,
    );
  }

  if (kind === 6) {
    const ipv6Bytes = parseIpv6ToBytes(withoutZoneId);
    if (!ipv6Bytes) {
      return true;
    }

    if (isIpv6V4Mapped(ipv6Bytes)) {
      const ipv4Value = ipv4BytesToUint32(ipv6Bytes, 12);
      if (
        BLOCKED_IPV4_CIDRS.some(
          (rule) => (ipv4Value & rule.mask) === rule.base,
        )
      ) {
        return true;
      }
    }

    return BLOCKED_IPV6_CIDRS.some((rule) => isInIpv6Cidr(ipv6Bytes, rule));
  }

  return true;
}

function removeDocTrackingParams(url: URL): void {
  const keys = Array.from(url.searchParams.keys());
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (
      lower.startsWith("utm_") ||
      lower === "fbclid" ||
      lower === "gclid" ||
      lower === "msclkid"
    ) {
      url.searchParams.delete(key);
    }
  }
}

function stripDefaultHttpsPort(url: URL): void {
  if (url.port === "443") {
    url.port = "";
  }
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true });
  return results.map((result) => result.address);
}

async function assertSafeDocHostname(
  hostname: string,
  context: string,
  resolveHostname: ResolveHostnameLike,
): Promise<void> {
  const normalized = normalizeHost(hostname).replace(/\.$/, "");

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    throw new Error(`${context}: host is not allowed`);
  }

  if (isIP(normalized) !== 0) {
    throw new Error(`${context}: host must not be an IP literal`);
  }

  let resolved: string[];
  try {
    resolved = await resolveHostname(normalized);
  } catch {
    throw new Error(`${context}: failed to resolve hostname`);
  }

  if (resolved.length === 0) {
    throw new Error(`${context}: failed to resolve hostname`);
  }

  if (resolved.some((ip) => isBlockedResolvedIp(ip))) {
    throw new Error(`${context}: resolved hostname is not allowed`);
  }
}

async function assertSafeDocUrl(
  url: URL,
  context: string,
  resolveHostname: ResolveHostnameLike,
): Promise<void> {
  if (url.protocol !== "https:") {
    throw new Error(`${context}: only https URLs are allowed`);
  }

  if (url.username || url.password) {
    throw new Error(`${context}: URL must not include credentials`);
  }

  if (url.port && url.port !== "443") {
    throw new Error(`${context}: URL must not include a non-default port`);
  }

  await assertSafeDocHostname(url.hostname, context, resolveHostname);
}

async function resolveDocRedirects(
  startUrl: URL,
  options: Required<
    Pick<NormalizeDocUrlOptions, "fetch" | "timeoutMs" | "resolveHostname">
  > & { maxRedirects: number },
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

    await assertSafeDocUrl(current, "redirect hop", options.resolveHostname);

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
    await assertSafeDocUrl(next, "redirect target", options.resolveHostname);
    current = next;
  }

  return current;
}

export async function normalizeDocUrl(
  input: string,
  options: NormalizeDocUrlOptions = {},
): Promise<{ canonicalUrl: string }> {
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

  url.hash = "";
  removeDocTrackingParams(url);
  stripDefaultHttpsPort(url);
  url.hostname = url.hostname.replace(/\.$/, "");

  const fetchFn = options.fetch ?? fetch;
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxRedirects = options.maxRedirects ?? 3;

  await assertSafeDocUrl(url, "input url", resolveHostname);

  url = await resolveDocRedirects(url, {
    fetch: fetchFn,
    timeoutMs,
    maxRedirects,
    resolveHostname,
  });

  url.hash = "";
  removeDocTrackingParams(url);
  stripDefaultHttpsPort(url);
  url.hostname = url.hostname.replace(/\.$/, "");

  await assertSafeDocUrl(url, "resolved url", resolveHostname);

  return { canonicalUrl: url.toString() };
}
