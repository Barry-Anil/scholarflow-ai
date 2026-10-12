"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv, getSupabasePublicKey } from "@/lib/env";

export function createClientSupabaseClient() {
  const env = getPublicEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local.",
    );
  }
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getSupabasePublicKey(env),
  );
}
