import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "scholarflow-ai" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
