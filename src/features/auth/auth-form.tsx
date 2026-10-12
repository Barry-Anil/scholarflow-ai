"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthActionState } from "./actions";

type AuthMode = "login" | "signup" | "forgot" | "update";
type AuthAction = (
  state: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;

const initialState: AuthActionState = { status: "idle" };

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs font-medium text-rose-600">{errors[0]}</p>;
}

export function AuthForm({
  mode,
  action,
}: {
  mode: AuthMode;
  action: AuthAction;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const needsEmail = mode !== "update";
  const needsPassword =
    mode === "login" || mode === "signup" || mode === "update";

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {mode === "signup" && (
        <div className="space-y-2">
          <Label htmlFor="displayName">Full name</Label>
          <Input
            id="displayName"
            name="displayName"
            autoComplete="name"
            placeholder="Alex Morgan"
          />
          <FieldError errors={state.fieldErrors?.displayName} />
        </div>
      )}

      {needsEmail && (
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@university.edu"
          />
          <FieldError errors={state.fieldErrors?.email} />
        </div>
      )}

      {needsPassword && (
        <div className="space-y-2">
          <Label htmlFor="password">
            {mode === "update" ? "New password" : "Password"}
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            placeholder="At least 8 characters"
          />
          <FieldError errors={state.fieldErrors?.password} />
        </div>
      )}

      {mode === "signup" && (
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
          />
          <FieldError errors={state.fieldErrors?.confirmPassword} />
        </div>
      )}

      {state.message && (
        <div
          role="status"
          className={
            state.status === "success"
              ? "rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800"
              : "rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          }
        >
          {state.message}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending
          ? "Working…"
          : mode === "login"
            ? "Sign in"
            : mode === "signup"
              ? "Create account"
              : mode === "forgot"
                ? "Send recovery link"
                : "Update password"}
      </Button>
    </form>
  );
}
