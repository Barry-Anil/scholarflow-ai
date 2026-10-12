"use client";

import { Plus } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCourseAction, type CourseActionState } from "./actions";

const initialState: CourseActionState = { status: "idle" };

export function NewCourseForm() {
  const [state, action, pending] = useActionState(
    createCourseAction,
    initialState,
  );
  return (
    <form
      action={action}
      className="grid gap-4 sm:grid-cols-[130px_1fr_auto] sm:items-end"
    >
      <div className="space-y-2">
        <Label htmlFor="code">Course code</Label>
        <Input id="code" name="code" placeholder="COMP101" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="title">Course title</Label>
        <Input
          id="title"
          name="title"
          placeholder="Foundations of Computing"
          required
        />
      </div>
      <Button type="submit" variant="accent" disabled={pending}>
        <Plus className="size-4" />
        {pending ? "Creating…" : "Create course"}
      </Button>
      {state.message && (
        <p
          role="status"
          className={`text-sm sm:col-span-3 ${state.status === "error" ? "text-rose-600" : "text-teal-700"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
