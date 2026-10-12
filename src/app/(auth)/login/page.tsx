import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/features/auth/auth-form";
import { loginAction } from "@/features/auth/actions";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="w-full">
      <p className="text-sm font-semibold text-teal-700">Welcome back</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        Sign in to your workspace
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        Continue your assignments, evidence review, and revision history.
      </p>
      <div className="mt-8">
        <AuthForm mode="login" action={loginAction} />
      </div>
      <div className="mt-5 flex items-center justify-between text-sm">
        <Link
          href="/forgot-password"
          className="font-medium text-slate-600 hover:text-teal-700"
        >
          Forgot password?
        </Link>
        <span className="text-slate-500">
          New here?{" "}
          <Link
            href="/signup"
            className="font-semibold text-slate-950 hover:text-teal-700"
          >
            Create account
          </Link>
        </span>
      </div>
    </div>
  );
}
