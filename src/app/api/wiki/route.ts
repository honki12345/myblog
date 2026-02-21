import { NextResponse } from "next/server";
import { getWikiRootOverview } from "@/lib/wiki";

type ApiErrorCode = "INTERNAL_ERROR";

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

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const overview = getWikiRootOverview();
    return NextResponse.json({
      summary: {
        totalComments: overview.totalComments,
        totalPaths: overview.totalPaths,
        totalCategories: overview.categories.length,
      },
      categories: overview.categories,
    });
  } catch {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to load wiki root overview.",
    );
  }
}
