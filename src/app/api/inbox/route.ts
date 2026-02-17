import { NextResponse } from "next/server";
import { z } from "zod";
import { getBearerToken, verifyApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeXStatusUrl } from "@/lib/inbox-url";
import { checkRateLimit } from "@/lib/rate-limit";

type ApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

type InboxStatus = "queued" | "processed" | "failed";

type InboxItemRow = {
  id: number;
  url: string;
  source: string;
  client: string;
  note: string | null;
  status: InboxStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
};

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

function parseRequestJson(request: Request) {
  return request.json().catch(() => null) as Promise<unknown | null>;
}

function validateApiKey(request: Request): NextResponse | null {
  const token = getBearerToken(request);
  if (!verifyApiKey(token)) {
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Invalid or missing API key.",
    );
  }

  return null;
}

function optionalTrimmedString(maxLength: number, fieldName: string) {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    z
      .string()
      .max(maxLength, `${fieldName} must be ${maxLength} characters or fewer`)
      .optional(),
  );
}

const createInboxItemSchema = z.object({
  url: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z
      .string()
      .max(2048, "url must be 2048 characters or fewer")
      .refine((value) => value.trim().length > 0, {
        message: "url is required",
      }),
  ),
  source: z.literal("x"),
  client: z.literal("ios_shortcuts"),
  note: optionalTrimmedString(1000, "note"),
});

function parsePositiveIntegerEnv(
  envValue: string | undefined,
  fallback: number,
): number {
  if (!envValue) {
    return fallback;
  }

  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const INBOX_RATE_LIMIT_MAX_REQUESTS = parsePositiveIntegerEnv(
  process.env.INBOX_RATE_LIMIT_MAX_REQUESTS,
  10,
);
const INBOX_RATE_LIMIT_WINDOW_MS = parsePositiveIntegerEnv(
  process.env.INBOX_RATE_LIMIT_WINDOW_MS,
  60_000,
);
const RATE_LIMIT_KEY_PREFIX = "inbox:post:";

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = validateApiKey(request);
  if (authError) {
    return authError;
  }

  const url = new URL(request.url);
  const statusParam = (url.searchParams.get("status") ?? "queued").trim();
  const limitParam = url.searchParams.get("limit");

  const status =
    statusParam === "queued" ||
    statusParam === "processed" ||
    statusParam === "failed"
      ? (statusParam as InboxStatus)
      : null;
  if (!status) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "status must be one of queued, processed, failed.",
    );
  }

  let limit = 50;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return errorResponse(
        400,
        "INVALID_INPUT",
        "limit must be a positive integer.",
      );
    }

    limit = Math.min(100, parsed);
  }

  try {
    const db = getDb();
    const rows = db
      .prepare(
        `
        SELECT id, url, source, client, note, status, error, created_at, updated_at
        FROM inbox_items
        WHERE status = ?
        ORDER BY id ASC
        LIMIT ?
        `,
      )
      .all(status, limit) as InboxItemRow[];

    return NextResponse.json({ items: rows });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to load inbox items.");
  }
}

export async function POST(request: Request) {
  const token = getBearerToken(request);
  if (!verifyApiKey(token)) {
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Invalid or missing API key.",
    );
  }

  const clientIp = getClientIp(request);
  const rate = checkRateLimit(
    `${RATE_LIMIT_KEY_PREFIX}${token}:${clientIp}`,
    INBOX_RATE_LIMIT_MAX_REQUESTS,
    INBOX_RATE_LIMIT_WINDOW_MS,
  );
  if (!rate.allowed) {
    const response = errorResponse(
      429,
      "RATE_LIMITED",
      "Rate limit exceeded.",
      { retryAfterMs: rate.retryAfterMs },
    );
    response.headers.set(
      "Retry-After",
      String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))),
    );
    return response;
  }

  const payload = await parseRequestJson(request);
  if (payload === null) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON.",
    );
  }

  const parsed = createInboxItemSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Request body validation failed.",
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }

  let canonicalUrl: string;
  try {
    const normalized = await normalizeXStatusUrl(parsed.data.url);
    canonicalUrl = normalized.canonicalUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(
      400,
      "INVALID_INPUT",
      "url must be a valid X status URL.",
      { reason: message },
    );
  }

  try {
    const db = getDb();
    const insert = db.prepare(
      `
      INSERT OR IGNORE INTO inbox_items (url, source, client, note)
      VALUES (?, ?, ?, ?)
      `,
    );
    const result = insert.run(
      canonicalUrl,
      parsed.data.source,
      parsed.data.client,
      parsed.data.note ?? null,
    );

    if (result.changes === 1) {
      return NextResponse.json(
        {
          ok: true,
          id: Number(result.lastInsertRowid),
          status: "queued",
        },
        { status: 201 },
      );
    }

    const existing = db
      .prepare("SELECT id FROM inbox_items WHERE url = ? LIMIT 1")
      .get(canonicalUrl) as { id: number } | undefined;
    if (existing) {
      return NextResponse.json({
        ok: true,
        id: existing.id,
        status: "duplicate",
      });
    }

    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to enqueue inbox item.",
    );
  } catch {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to enqueue inbox item.",
    );
  }
}
