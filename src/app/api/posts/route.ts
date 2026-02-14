import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ items: [] });
}

export async function POST() {
  return NextResponse.json(
    { error: "Post creation is not implemented in Step 1" },
    { status: 501 },
  );
}
