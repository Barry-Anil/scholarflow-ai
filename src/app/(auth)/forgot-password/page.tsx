import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/features/auth/auth-form";
import { forgotPasswordAction } from "@/features/auth/actions";

export const metadata: Metadata = { title: "Recover account" };

export default function ForgotPasswordPage() {
  return (
    <div className="w-full">
      <p className="text-sm font-semibold text-teal-700">Account recovery</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Reset your password
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        We will send a secure recovery link if the address belongs to an
        account.
      </p>
      <div className="mt-8">
        <AuthForm mode="forgot" action={forgotPasswordAction} />
      </div>
      <p className="mt-5 text-center text-sm">
        <Link
          href="/login"
          className="font-semibold text-slate-700 hover:text-teal-700"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
