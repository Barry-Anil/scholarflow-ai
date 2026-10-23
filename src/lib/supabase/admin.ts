import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseAdminEnv } from "@/lib/env/server";

let adminClient: ReturnType<typeof createClient> | undefined;

export function getSupabaseAdminClient() {
  const env = getSupabaseAdminEnv();
  adminClient ??= createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  return adminClient;
}
