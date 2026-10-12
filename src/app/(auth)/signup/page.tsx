import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/features/auth/auth-form";
import { signupAction } from "@/features/auth/actions";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <div className="w-full">
      <p className="text-sm font-semibold text-teal-700">Start thoughtfully</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        Create your ScholarFlow account
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        Your course materials and drafts remain private to authorized workspace
        members.
      </p>
      <div className="mt-8">
        <AuthForm mode="signup" action={signupAction} />
      </div>
      <p className="mt-5 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-semibold text-slate-950 hover:text-teal-700"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
