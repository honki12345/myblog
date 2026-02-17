import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  clearLoginChallengeCookie,
  ensureAdminConfigSynced,
  isAdminTotpEnabled,
  setLoginChallengeCookie,
  verifyAdminPrimaryCredentials,
} from "@/lib/admin-auth";
import { checkRateLimit } from "@/lib/rate-limit";

type ApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const loginSchema = z.object({
  username: z
    .string()
    .min(1, "username is required")
    .max(100, "username must be 100 characters or fewer"),
  password: z
    .string()
    .min(1, "password is required")
    .max(1_000, "password must be 1000 characters or fewer"),
});

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details: details ?? null,
      },
    },
    { status },
  );
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

function getRateLimitIdentifier(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

const RATE_LIMIT_MAX = parsePositiveIntegerEnv(
  process.env.ADMIN_LOGIN_RATE_LIMIT_MAX,
  10,
);
const RATE_LIMIT_WINDOW_MS = parsePositiveIntegerEnv(
  process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS,
  60_000,
);
const RATE_LIMIT_PREFIX = "admin:login:";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    ensureAdminConfigSynced();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Admin auth configuration error.";
    return errorResponse(500, "INTERNAL_ERROR", message);
  }

  const rate = checkRateLimit(
    `${RATE_LIMIT_PREFIX}${getRateLimitIdentifier(request)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );

  if (!rate.allowed) {
    const response = errorResponse(
      429,
      "RATE_LIMITED",
      "Rate limit exceeded.",
      {
        retryAfterMs: rate.retryAfterMs,
      },
    );
    response.headers.set(
      "Retry-After",
      String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))),
    );
    return response;
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON object.",
    );
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(400, "INVALID_INPUT", "Request validation failed.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const isValid = await verifyAdminPrimaryCredentials(
    parsed.data.username,
    parsed.data.password,
  );

  if (!isValid) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid username or password.");
  }

  const totpEnabled = isAdminTotpEnabled();
  const response = NextResponse.json(
    { requiresTwoFactor: true, totpEnabled },
    { status: 200 },
  );
  clearLoginChallengeCookie(response);
  setLoginChallengeCookie(response, parsed.data.username);
  return response;
}
