import type { Metadata } from "next";

import { AuthForm } from "@/features/auth/auth-form";
import { updatePasswordAction } from "@/features/auth/actions";

export const metadata: Metadata = { title: "Choose new password" };

export default function UpdatePasswordPage() {
  return (
    <div className="w-full">
      <p className="text-sm font-semibold text-teal-700">Secure your account</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Choose a new password
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        Use a unique password with at least eight characters.
      </p>
      <div className="mt-8">
        <AuthForm mode="update" action={updatePasswordAction} />
      </div>
    </div>
  );
}
