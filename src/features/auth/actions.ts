"use server";

import { redirect } from "next/navigation";

import { getPostAuthDestination } from "@/lib/auth/destination";
import { createServerSupabaseClient } from "@/lib/auth/server";
import { getPublicEnv } from "@/lib/env";
import { errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import {
  enforceAuthRateLimit,
  enforceUserRateLimit,
  type RateLimitScope,
} from "@/lib/security/rate-limit";
import {
  emailSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/validation/auth";

export type AuthActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

const initialFailure: AuthActionState = {
  status: "error",
  message: "Supabase is not configured. Add the required values to .env.local.",
};

function fields(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

async function authLimit(email: string, scope: RateLimitScope) {
  try {
    await enforceAuthRateLimit(email, scope);
    return null;
  } catch (error) {
    logger.error("auth.rate_limit_failed", {
      scope,
      ...errorFingerprint(error),
    });
    return { status: "error", message: safeErrorMessage(error) } as const;
  }
}

export async function loginAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse(fields(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const limited = await authLimit(parsed.data.email, "auth.login");
  if (limited) return limited;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return initialFailure;
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { status: "error", message: error.message };
  redirect(getPostAuthDestination());
}

export async function signupAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signupSchema.safeParse(fields(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const limited = await authLimit(parsed.data.email, "auth.signup");
  if (limited) return limited;
  const supabase = await createServerSupabaseClient();
  const env = getPublicEnv();
  if (!supabase || !env) return initialFailure;
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/dashboard`,
    },
  });
  if (error) return { status: "error", message: error.message };
  if (data.session) redirect(getPostAuthDestination());
  return {
    status: "success",
    message: "Check your email to verify your account.",
  };
}

export async function forgotPasswordAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: { email: parsed.error.issues.map((issue) => issue.message) },
    };
  }
  const limited = await authLimit(parsed.data, "auth.password-reset");
  if (limited) return limited;
  const supabase = await createServerSupabaseClient();
  const env = getPublicEnv();
  if (!supabase || !env) return initialFailure;
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/update-password`,
  });
  if (error) return { status: "error", message: error.message };
  return {
    status: "success",
    message: "If an account exists, a recovery link has been sent.",
  };
}

export async function updatePasswordAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse(fields(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return initialFailure;
  const { data: current } = await supabase.auth.getUser();
  if (current.user) {
    try {
      await enforceUserRateLimit(current.user.id, "auth.password-update");
    } catch (error) {
      return { status: "error", message: safeErrorMessage(error) };
    }
  }
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { status: "error", message: error.message };
  redirect(getPostAuthDestination());
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase?.auth.signOut();
  redirect("/");
}
