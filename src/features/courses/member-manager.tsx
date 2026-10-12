"use client";

import { LoaderCircle, UserPlus } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addCourseMemberAction,
  type MemberActionState,
} from "./member-actions";

const initialState: MemberActionState = { status: "idle" };

export function AddCourseMemberForm({ courseId }: { courseId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    addCourseMemberAction.bind(null, courseId),
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status]);

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-3 sm:grid-cols-[1fr_150px_auto] sm:items-end"
    >
      <label className="space-y-2 text-sm font-medium text-slate-700">
        Registered email
        <Input
          name="email"
          type="email"
          required
          placeholder="student@example.edu"
          disabled={pending}
        />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-700">
        Role
        <select
          name="role"
          defaultValue="viewer"
          disabled={pending}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/15"
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
      </label>
      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <UserPlus className="size-4" />
        )}
        Add member
      </Button>
      {state.message && (
        <p
          className={
            state.status === "error"
              ? "text-sm font-medium text-rose-600 sm:col-span-3"
              : "text-sm font-medium text-teal-700 sm:col-span-3"
          }
          role="status"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
