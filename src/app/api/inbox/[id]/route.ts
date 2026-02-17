import { NextResponse } from "next/server";
import { z } from "zod";
import { getBearerToken, verifyApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db";

type ApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type InboxStatus = "queued" | "processed" | "failed";

type InboxItemStatusRow = {
  id: number;
  status: InboxStatus;
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

function validateApiKey(request: Request): NextResponse | null {
  const token = getBearerToken(request);
  if (!verifyApiKey(token)) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or missing API key.");
  }

  return null;
}

function parseRequestJson(request: Request) {
  return request.json().catch(() => null) as Promise<Record<
    string,
    unknown
  > | null>;
}

function parseInboxItemId(rawId: string): number | null {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

const patchInboxItemSchema = z
  .object({
    status: z.enum(["processed", "failed"]),
    error: z.preprocess((value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    }, z.string().max(5000, "error must be 5000 characters or fewer").optional()),
  })
  .refine((input) => input.status === "failed" || input.error === undefined, {
    message: "error is only allowed when status=failed.",
    path: ["error"],
  });

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: RouteContext) {
  const authError = validateApiKey(request);
  if (authError) {
    return authError;
  }

  const { id } = await context.params;
  const inboxItemId = parseInboxItemId(id);
  if (!inboxItemId) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }

  const payload = await parseRequestJson(request);
  if (payload === null) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON.",
    );
  }

  const parsed = patchInboxItemSchema.safeParse(payload);
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

  try {
    const db = getDb();
    const current = db
      .prepare("SELECT id, status FROM inbox_items WHERE id = ? LIMIT 1")
      .get(inboxItemId) as InboxItemStatusRow | undefined;

    if (!current) {
      return errorResponse(404, "NOT_FOUND", "Inbox item not found.");
    }

    if (current.status !== "queued") {
      return errorResponse(
        400,
        "INVALID_INPUT",
        "Only queued items can be updated.",
      );
    }

    const nextError =
      parsed.data.status === "failed" ? (parsed.data.error ?? null) : null;

    const result = db
      .prepare(
        `
      UPDATE inbox_items
      SET status = ?, error = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'queued'
      `,
      )
      .run(parsed.data.status, nextError, inboxItemId);

    if (result.changes === 0) {
      return errorResponse(
        400,
        "INVALID_INPUT",
        "Only queued items can be updated.",
      );
    }

    return NextResponse.json({
      ok: true,
      id: inboxItemId,
      status: parsed.data.status,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to update inbox item.");
  }
}
