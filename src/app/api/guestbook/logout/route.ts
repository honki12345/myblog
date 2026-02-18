import { NextRequest, NextResponse } from "next/server";
import {
  clearGuestbookSessionCookie,
  deleteGuestbookSessionById,
  getGuestbookSessionIdFromRequest,
} from "@/lib/guestbook";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionId = getGuestbookSessionIdFromRequest(request);
  if (sessionId) {
    deleteGuestbookSessionById(sessionId);
  }

  const response = NextResponse.json({ ok: true });
  clearGuestbookSessionCookie(response);
  return response;
}
