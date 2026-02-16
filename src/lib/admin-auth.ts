import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { verify as verifyArgon2Hash } from "@node-rs/argon2";
import { getDb } from "@/lib/db";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  hashRecoveryCode,
  normalizeTotpSecret,
  verifyTotpCode,
} from "@/lib/admin-totp";

export const ADMIN_SESSION_COOKIE_NAME = "admin_session";
export const ADMIN_LOGIN_CHALLENGE_COOKIE_NAME = "admin_login_challenge";

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const LOGIN_CHALLENGE_MAX_AGE_SECONDS = 10 * 60;

type AdminAuthConfig = {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  totpEncryptionKey: string;
  normalizedTotpSecret: string;
  sessionMaxAgeSeconds: number;
};

export type AdminSessionRow = {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  ip_hash: string | null;
  user_agent: string | null;
};

type AdminAuthRow = {
  id: number;
  username: string;
  password_hash: string;
  totp_secret_encrypted: string;
};

function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

function parsePositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getConfiguredTotpSecret(
  username: string,
  passwordHash: string,
  totpEncryptionKey: string,
): string {
  const explicitSecret = process.env.ADMIN_TOTP_SECRET?.trim();
  if (explicitSecret) {
    return normalizeTotpSecret(explicitSecret);
  }

  const fallbackMaterial = createHash("sha256")
    .update(username)
    .update(":")
    .update(passwordHash)
    .update(":")
    .update(totpEncryptionKey)
    .digest("hex");
  return normalizeTotpSecret(fallbackMaterial);
}

function loadAdminConfig(): AdminAuthConfig {
  const username = getRequiredEnv("ADMIN_USERNAME");
  const passwordHash = getRequiredEnv("ADMIN_PASSWORD_HASH");
  if (!passwordHash.startsWith("$argon2id$")) {
    throw new Error("ADMIN_PASSWORD_HASH must be an Argon2id hash.");
  }

  const sessionSecret = getRequiredEnv("ADMIN_SESSION_SECRET");
  const totpEncryptionKey = getRequiredEnv("ADMIN_TOTP_SECRET_ENCRYPTION_KEY");

  return {
    username,
    passwordHash,
    sessionSecret,
    totpEncryptionKey,
    normalizedTotpSecret: getConfiguredTotpSecret(
      username,
      passwordHash,
      totpEncryptionKey,
    ),
    sessionMaxAgeSeconds: parsePositiveIntegerEnv(
      process.env.ADMIN_SESSION_MAX_AGE_SECONDS,
      DEFAULT_SESSION_MAX_AGE_SECONDS,
    ),
  };
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

function hashClientIp(ip: string, sessionSecret: string): string {
  return createHash("sha256")
    .update(sessionSecret)
    .update(":")
    .update(ip)
    .digest("hex");
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
    result[rawKey] = decodeURIComponent(rest.join("="));
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

function signWithSessionSecret(payload: string): string {
  const sessionSecret = getRequiredEnv("ADMIN_SESSION_SECRET");
  return createHmac("sha256", sessionSecret).update(payload).digest("base64url");
}

function loadAdminAuthRow(): AdminAuthRow {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT id, username, password_hash, totp_secret_encrypted
      FROM admin_auth
      WHERE id = 1
      LIMIT 1
      `,
    )
    .get() as AdminAuthRow | undefined;

  if (!row) {
    throw new Error("admin_auth row is missing.");
  }

  return row;
}

function syncRecoveryCodesFromEnv(config: AdminAuthConfig): void {
  const rawCodes = process.env.ADMIN_RECOVERY_CODES;
  if (!rawCodes) {
    return;
  }

  const codes = rawCodes
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (codes.length === 0) {
    return;
  }

  const db = getDb();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO admin_recovery_codes (code_hash) VALUES (?)",
  );

  db.transaction(() => {
    for (const code of codes) {
      insert.run(hashRecoveryCode(code, config.sessionSecret));
    }
  })();
}

export function ensureAdminConfigSynced(): void {
  const config = loadAdminConfig();
  const encryptedTotpSecret = encryptTotpSecret(
    config.normalizedTotpSecret,
    config.totpEncryptionKey,
  );
  const db = getDb();

  db.prepare(
    `
    INSERT INTO admin_auth (id, username, password_hash, totp_secret_encrypted)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      password_hash = excluded.password_hash,
      totp_secret_encrypted = excluded.totp_secret_encrypted,
      updated_at = datetime('now')
    `,
  ).run(config.username, config.passwordHash, encryptedTotpSecret);

  syncRecoveryCodesFromEnv(config);
}

export function getAdminSessionMaxAgeSeconds(): number {
  return loadAdminConfig().sessionMaxAgeSeconds;
}

export async function verifyAdminPrimaryCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  ensureAdminConfigSynced();
  const adminAuth = loadAdminAuthRow();
  if (!safeEqualString(username, adminAuth.username)) {
    return false;
  }

  return verifyArgon2Hash(adminAuth.password_hash, password);
}

function buildLoginChallengeToken(username: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(18).toString("base64url");
  const usernamePart = Buffer.from(username, "utf8").toString("base64url");
  const payload = `v1.${usernamePart}.${issuedAt}.${nonce}`;
  const signature = signWithSessionSecret(payload);
  return `${payload}.${signature}`;
}

export function setLoginChallengeCookie(
  response: NextResponse,
  username: string,
): void {
  response.cookies.set(
    ADMIN_LOGIN_CHALLENGE_COOKIE_NAME,
    buildLoginChallengeToken(username),
    {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookies(),
      maxAge: LOGIN_CHALLENGE_MAX_AGE_SECONDS,
    },
  );
}

export function clearLoginChallengeCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_LOGIN_CHALLENGE_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    expires: new Date(0),
  });
}

export function readAndVerifyLoginChallenge(
  request: Request | NextRequest,
): string | null {
  const token = readRequestCookie(request, ADMIN_LOGIN_CHALLENGE_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const [version, usernamePart, issuedAtPart, nonce, signature] = token.split(".");
  if (!version || !usernamePart || !issuedAtPart || !nonce || !signature) {
    return null;
  }
  if (version !== "v1") {
    return null;
  }

  const payload = `${version}.${usernamePart}.${issuedAtPart}.${nonce}`;
  const expected = signWithSessionSecret(payload);
  if (!safeEqualString(expected, signature)) {
    return null;
  }

  const issuedAt = Number(issuedAtPart);
  if (!Number.isFinite(issuedAt)) {
    return null;
  }

  const current = Math.floor(Date.now() / 1000);
  if (current - issuedAt > LOGIN_CHALLENGE_MAX_AGE_SECONDS) {
    return null;
  }

  return Buffer.from(usernamePart, "base64url").toString("utf8");
}

export async function verifyAdminSecondFactor(
  code: string,
): Promise<{ ok: boolean; method: "totp" | "recovery" | null }> {
  ensureAdminConfigSynced();
  const config = loadAdminConfig();
  const auth = loadAdminAuthRow();
  const totpSecret = decryptTotpSecret(
    auth.totp_secret_encrypted,
    config.totpEncryptionKey,
  );

  if (verifyTotpCode(totpSecret, code)) {
    return { ok: true, method: "totp" };
  }

  const recoveryHash = hashRecoveryCode(code, config.sessionSecret);
  const db = getDb();
  const result = db
    .prepare(
      `
      UPDATE admin_recovery_codes
      SET used_at = datetime('now')
      WHERE code_hash = ? AND used_at IS NULL
      `,
    )
    .run(recoveryHash);

  if (result.changes === 1) {
    return { ok: true, method: "recovery" };
  }

  return { ok: false, method: null };
}

export function setAdminSessionCookie(
  response: NextResponse,
  sessionId: string,
  maxAgeSeconds = getAdminSessionMaxAgeSeconds(),
): void {
  response.cookies.set(ADMIN_SESSION_COOKIE_NAME, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    maxAge: maxAgeSeconds,
  });
}

export function clearAdminSessionCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_SESSION_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    expires: new Date(0),
  });
}

function removeExpiredSessions(): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM admin_sessions WHERE datetime(expires_at) <= datetime('now')",
  ).run();
}

export function createAdminSession(request: Request): {
  sessionId: string;
  maxAgeSeconds: number;
} {
  removeExpiredSessions();
  const config = loadAdminConfig();
  const sessionId = randomBytes(32).toString("base64url");
  const ipHash = hashClientIp(extractClientIp(request), config.sessionSecret);
  const userAgent = request.headers.get("user-agent");
  const maxAgeSeconds = config.sessionMaxAgeSeconds;
  const db = getDb();

  db.prepare(
    `
    INSERT INTO admin_sessions (id, user_id, expires_at, ip_hash, user_agent)
    VALUES (?, 1, datetime('now', '+' || ? || ' seconds'), ?, ?)
    `,
  ).run(sessionId, maxAgeSeconds, ipHash, userAgent);

  return { sessionId, maxAgeSeconds };
}

function parseSqliteDate(value: string): number {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withTimezone = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
  return new Date(withTimezone).getTime();
}

export function getAdminSessionById(
  sessionId: string,
  { touch = true }: { touch?: boolean } = {},
): AdminSessionRow | null {
  removeExpiredSessions();
  const db = getDb();
  const session = db
    .prepare(
      `
      SELECT id, user_id, created_at, expires_at, last_seen_at, ip_hash, user_agent
      FROM admin_sessions
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(sessionId) as AdminSessionRow | undefined;

  if (!session) {
    return null;
  }

  const expiresAt = parseSqliteDate(session.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(sessionId);
    return null;
  }

  if (touch) {
    db.prepare(
      "UPDATE admin_sessions SET last_seen_at = datetime('now') WHERE id = ?",
    ).run(sessionId);
  }

  return session;
}

export function getAdminSessionFromRequest(
  request: Request | NextRequest,
  options?: { touch?: boolean },
): AdminSessionRow | null {
  const sessionId = readRequestCookie(request, ADMIN_SESSION_COOKIE_NAME);
  if (!sessionId) {
    return null;
  }
  return getAdminSessionById(sessionId, options);
}

export function deleteAdminSessionById(sessionId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(sessionId);
}

export function getAdminSessionIdFromRequest(
  request: Request | NextRequest,
): string | null {
  return readRequestCookie(request, ADMIN_SESSION_COOKIE_NAME);
}

export async function getAdminSessionFromServerCookies(): Promise<AdminSessionRow | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!sessionId) {
    return null;
  }

  return getAdminSessionById(sessionId, { touch: true });
}
