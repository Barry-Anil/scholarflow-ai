import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv, getSupabasePublicKey } from "@/lib/env";
import { getConfigurationStatus } from "@/lib/env/server";
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@/lib/observability/request-id";

const authRoutes = new Set(["/login", "/signup", "/forgot-password"]);

export async function updateSession(request: NextRequest) {
  const env = getPublicEnv();
  const path = request.nextUrl.pathname;
  const workspaceReady = getConfigurationStatus().ready;
  const requestHeaders = new Headers(request.headers);
  const requestId = resolveRequestId(requestHeaders);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const finish = (response: NextResponse) => {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  };

  if (path.startsWith("/dashboard") && !workspaceReady) {
    return finish(NextResponse.redirect(new URL("/setup", request.url)));
  }
  if (!env) {
    return finish(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getSupabasePublicKey(env),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  if (path.startsWith("/dashboard") && !data.user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", path);
    return finish(NextResponse.redirect(loginUrl));
  }
  if (data.user && authRoutes.has(path)) {
    const destination = workspaceReady ? "/dashboard" : "/setup";
    return finish(NextResponse.redirect(new URL(destination, request.url)));
  }
  return finish(response);
}
