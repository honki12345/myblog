import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  type BinaryLike,
} from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const ADMIN_CSRF_COOKIE_NAME = "admin_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

function getCsrfSecret(): string {
  const value = process.env.ADMIN_CSRF_SECRET?.trim();
  if (!value) {
    throw new Error("ADMIN_CSRF_SECRET is required.");
  }
  return value;
}

function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

function signCsrfPayload(payload: BinaryLike): string {
  return createHmac("sha256", getCsrfSecret())
    .update(payload)
    .digest("base64url");
}

function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookieHeader(rawHeader: string | null): Record<string, string> {
  if (!rawHeader) {
    return {};
  }

  const map: Record<string, string> = {};
  const chunks = rawHeader.split(";");
  for (const chunk of chunks) {
    const [rawKey, ...rest] = chunk.trim().split("=");
    if (!rawKey || rest.length === 0) {
      continue;
    }
    map[rawKey] = decodeURIComponent(rest.join("="));
  }
  return map;
}

export function createSignedCsrfToken(sessionId: string): string {
  const nonce = randomBytes(18).toString("base64url");
  const signature = signCsrfPayload(`${sessionId}.${nonce}`);
  return `${nonce}.${signature}`;
}

export function setCsrfCookie(
  response: NextResponse,
  sessionId: string,
  maxAgeSeconds: number,
): string {
  const token = createSignedCsrfToken(sessionId);
  response.cookies.set(ADMIN_CSRF_COOKIE_NAME, token, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    maxAge: maxAgeSeconds,
  });
  return token;
}

export function clearCsrfCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_CSRF_COOKIE_NAME, "", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    expires: new Date(0),
  });
}

export function readCsrfCookieToken(
  request: Request | NextRequest,
): string | null {
  if ("cookies" in request && request.cookies) {
    return request.cookies.get(ADMIN_CSRF_COOKIE_NAME)?.value ?? null;
  }

  const cookieMap = parseCookieHeader(request.headers.get("cookie"));
  return cookieMap[ADMIN_CSRF_COOKIE_NAME] ?? null;
}

export function readCsrfHeaderToken(request: Request): string | null {
  const value = request.headers.get(CSRF_HEADER_NAME);
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSignedTokenValid(sessionId: string, token: string): boolean {
  const [nonce, signature] = token.split(".");
  if (!nonce || !signature) {
    return false;
  }

  const expected = signCsrfPayload(`${sessionId}.${nonce}`);
  return safeEqualString(expected, signature);
}

export function verifySignedDoubleSubmitCsrf(
  request: Request | NextRequest,
  sessionId: string,
): { valid: true } | { valid: false; reason: string } {
  const headerToken = readCsrfHeaderToken(request);
  const cookieToken = readCsrfCookieToken(request);

  if (!headerToken || !cookieToken) {
    return { valid: false, reason: "Missing CSRF token." };
  }

  if (!safeEqualString(headerToken, cookieToken)) {
    return { valid: false, reason: "Mismatched CSRF token." };
  }

  if (!isSignedTokenValid(sessionId, headerToken)) {
    return { valid: false, reason: "Invalid CSRF token signature." };
  }

  return { valid: true };
}
