import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourceUrl = url.searchParams.get("source_url") ?? "";

  return NextResponse.json({ sourceUrl, duplicate: false });
}
