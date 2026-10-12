import { NextResponse, type NextRequest } from "next/server";

import { getPostAuthDestination } from "@/lib/auth/destination";
import { createServerSupabaseClient } from "@/lib/auth/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = getPostAuthDestination(request.nextUrl.searchParams.get("next"));
  const supabase = await createServerSupabaseClient();

  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(
    new URL("/login?error=auth_callback_failed", request.url),
  );
}
