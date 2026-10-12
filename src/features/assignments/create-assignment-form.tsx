"use client";

import { ArrowRight, FilePlus2 } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAssignmentAction, type AssignmentActionState } from "./actions";

const initialState: AssignmentActionState = { status: "idle" };

export function CreateAssignmentForm({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState(
    createAssignmentAction.bind(null, courseId),
    initialState,
  );

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="space-y-2">
          <Label htmlFor="assignment-title">Assignment title</Label>
          <Input
            id="assignment-title"
            name="title"
            placeholder="Research essay"
            minLength={3}
            maxLength={280}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="assignment-due">Due date</Label>
          <Input id="assignment-due" name="dueAt" type="datetime-local" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="assignment-brief">Assignment brief</Label>
        <Textarea
          id="assignment-brief"
          name="brief"
          className="min-h-52"
          placeholder={
            "Question 1. Explain the core concept (500 words)\n- Use two course readings\n\nQuestion 2. Apply the concept to a case study (800 words)"
          }
          minLength={20}
          maxLength={100000}
          required
        />
        <p className="text-xs leading-5 text-slate-500">
          Numbered questions and bullet requirements become an editable answer
          structure in the workspace.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="assignment-rubric">Marking rubric</Label>
        <Textarea
          id="assignment-rubric"
          name="rubric"
          placeholder={
            "Critical analysis (40%) - Evaluates evidence and competing views\nUse of sources (30%) - Integrates credible course material"
          }
          maxLength={50000}
        />
        <p className="text-xs leading-5 text-slate-500">
          Put one criterion on each line. Percentages are detected when present.
        </p>
      </div>

      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center">
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            name="externalResearchAllowed"
            className="mt-0.5 size-4 rounded border-slate-300 accent-teal-600"
          />
          <span>
            <span className="font-semibold text-slate-800">
              Allow external research
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Course materials will still be searched first.
            </span>
          </span>
        </label>
        <Button type="submit" variant="accent" disabled={pending}>
          <FilePlus2 className="size-4" />
          {pending ? "Creating workspace…" : "Create workspace"}
          {!pending && <ArrowRight className="size-4" />}
        </Button>
      </div>
      {state.message && (
        <p
          role="status"
          className={
            state.status === "error"
              ? "text-sm text-rose-600"
              : "text-sm text-teal-700"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
