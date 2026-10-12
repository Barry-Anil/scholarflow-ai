import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "./server";

export const getOptionalUser = cache(async () => {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
});

export const requireUser = cache(async () => {
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  return user;
});
