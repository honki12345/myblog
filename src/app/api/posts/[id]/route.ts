import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  return NextResponse.json({ id, message: "Post detail endpoint placeholder" });
}

export async function PATCH(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  return NextResponse.json(
    { id, error: "Post update is not implemented in Step 1" },
    { status: 501 },
  );
}
