import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import {
  ensureAdminConfigSynced,
  getAdminTotpSetupInfoFromLoginChallenge,
} from "@/lib/admin-auth";

type ApiErrorCode = "UNAUTHORIZED" | "INTERNAL_ERROR";

function errorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const setup = getAdminTotpSetupInfoFromLoginChallenge(request);
  if (!setup) {
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Two-factor challenge is missing or expired.",
    );
  }

  try {
    ensureAdminConfigSynced();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Admin auth configuration error.";
    return errorResponse(500, "INTERNAL_ERROR", message);
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(setup.otpauthUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    });

    return NextResponse.json(
      {
        ...setup,
        qrDataUrl,
      },
      { status: 200 },
    );
  } catch {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to generate TOTP setup QR.",
    );
  }
}
