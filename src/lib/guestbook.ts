import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const GUESTBOOK_SESSION_COOKIE_NAME = "guestbook_session";

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type GuestbookSessionRow = {
  id: string;
  thread_id: number;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  ip_hash: string | null;
  user_agent: string | null;
};

function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

function parseCookieHeader(rawCookie: string | null): Record<string, string> {
  if (!rawCookie) {
    return {};
  }

  const result: Record<string, string> = {};
  const parts = rawCookie.split(";");
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey || rest.length === 0) {
      continue;
    }
    const rawValue = rest.join("=");
    try {
      result[rawKey] = decodeURIComponent(rawValue);
    } catch {
      result[rawKey] = rawValue;
    }
  }

  return result;
}

function readRequestCookie(
  request: Request | NextRequest,
  name: string,
): string | null {
  if ("cookies" in request && request.cookies) {
    return request.cookies.get(name)?.value ?? null;
  }

  const cookieMap = parseCookieHeader(request.headers.get("cookie"));
  return cookieMap[name] ?? null;
}

function extractClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

function hashClientIp(ip: string): string {
  return createHash("sha256").update("guestbook:").update(ip).digest("hex");
}

function removeExpiredGuestbookSessions(): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM guestbook_sessions WHERE datetime(expires_at) <= datetime('now')",
  ).run();
}

function parseSqliteDate(value: string): number {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withTimezone = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
  return new Date(withTimezone).getTime();
}

export function setGuestbookSessionCookie(
  response: NextResponse,
  sessionId: string,
  maxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS,
): void {
  response.cookies.set(GUESTBOOK_SESSION_COOKIE_NAME, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    maxAge: maxAgeSeconds,
  });
}

export function clearGuestbookSessionCookie(response: NextResponse): void {
  response.cookies.set(GUESTBOOK_SESSION_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    expires: new Date(0),
  });
}

export function createGuestbookSession(request: Request, threadId: number): {
  sessionId: string;
  maxAgeSeconds: number;
} {
  removeExpiredGuestbookSessions();
  const sessionId = randomBytes(32).toString("base64url");
  const ipHash = hashClientIp(extractClientIp(request));
  const userAgent = request.headers.get("user-agent");
  const maxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS;

  const db = getDb();
  db.prepare(
    `
    INSERT INTO guestbook_sessions (id, thread_id, expires_at, ip_hash, user_agent)
    VALUES (?, ?, datetime('now', '+' || ? || ' seconds'), ?, ?)
    `,
  ).run(sessionId, threadId, maxAgeSeconds, ipHash, userAgent);

  return { sessionId, maxAgeSeconds };
}

export function deleteGuestbookSessionById(sessionId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM guestbook_sessions WHERE id = ?").run(sessionId);
}

export function getGuestbookSessionById(
  sessionId: string,
  { touch = true }: { touch?: boolean } = {},
): GuestbookSessionRow | null {
  removeExpiredGuestbookSessions();
  const db = getDb();
  const session = db
    .prepare(
      `
      SELECT id, thread_id, created_at, expires_at, last_seen_at, ip_hash, user_agent
      FROM guestbook_sessions
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(sessionId) as GuestbookSessionRow | undefined;

  if (!session) {
    return null;
  }

  const expiresAt = parseSqliteDate(session.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    db.prepare("DELETE FROM guestbook_sessions WHERE id = ?").run(sessionId);
    return null;
  }

  if (touch) {
    db.prepare(
      "UPDATE guestbook_sessions SET last_seen_at = datetime('now') WHERE id = ?",
    ).run(sessionId);
  }

  return session;
}

export function getGuestbookSessionFromRequest(
  request: Request | NextRequest,
  options?: { touch?: boolean },
): GuestbookSessionRow | null {
  const sessionId = readRequestCookie(request, GUESTBOOK_SESSION_COOKIE_NAME);
  if (!sessionId) {
    return null;
  }
  return getGuestbookSessionById(sessionId, options);
}

export function getGuestbookSessionIdFromRequest(
  request: Request | NextRequest,
): string | null {
  return readRequestCookie(request, GUESTBOOK_SESSION_COOKIE_NAME);
}

