"use client";

import {
  BookOpenCheck,
  PenLine,
  RotateCcw,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  startResearchAgentAction,
  startReviewAgentAction,
  startRevisionAgentAction,
  startStudentAgentAction,
} from "./actions";

export function AgentControls({
  courseId,
  assignmentId,
  sourceCount,
  model,
  externalResearchEnabled,
  busy,
  hasDraft,
  reviewerModel,
  canRevise,
  revisionCount,
  maxIterations,
}: {
  courseId: string;
  assignmentId: string;
  sourceCount: number;
  model: string;
  externalResearchEnabled: boolean;
  busy: boolean;
  hasDraft: boolean;
  reviewerModel: string;
  canRevise: boolean;
  revisionCount: number;
  maxIterations: number;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex gap-3">
          <BookOpenCheck className="mt-0.5 size-4 shrink-0 text-teal-600" />
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Course evidence comes first
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {externalResearchEnabled
                ? "Crossref scholarly abstracts may supplement gaps because this assignment permits external research."
                : "External search is disabled for this assignment."}
            </p>
          </div>
        </div>
      </div>
      <form
        action={startResearchAgentAction.bind(null, courseId, assignmentId)}
      >
        <AgentButton
          icon={SearchCheck}
          idleLabel="Run Agent C research"
          pendingLabel="Retrieving evidence…"
          variant="secondary"
          disabled={busy}
        />
      </form>
      <form action={startStudentAgentAction.bind(null, courseId, assignmentId)}>
        <AgentButton
          icon={PenLine}
          idleLabel="Generate Agent B draft"
          pendingLabel="Drafting with evidence…"
          disabled={busy || !sourceCount}
          variant="accent"
        />
      </form>
      <form action={startReviewAgentAction.bind(null, courseId, assignmentId)}>
        <AgentButton
          icon={ShieldCheck}
          idleLabel="Run Agent A review"
          pendingLabel="Starting independent review…"
          disabled={busy || !hasDraft}
          variant="secondary"
        />
      </form>
      <form
        action={startRevisionAgentAction.bind(null, courseId, assignmentId)}
      >
        <AgentButton
          icon={RotateCcw}
          idleLabel="Revise accepted findings"
          pendingLabel="Starting controlled revision…"
          disabled={busy || !canRevise || revisionCount >= maxIterations}
          variant="accent"
        />
      </form>
      <p className="text-xs leading-5 text-slate-500">
        {busy
          ? "An agent run is in progress. This page will update as each task finishes."
          : `${sourceCount} source${sourceCount === 1 ? "" : "s"} · revision ${revisionCount}/${maxIterations} · writer ${model} · reviewer ${reviewerModel}`}
      </p>
    </div>
  );
}

function AgentButton({
  icon: Icon,
  idleLabel,
  pendingLabel,
  disabled,
  variant,
}: {
  icon: typeof SearchCheck;
  idleLabel: string;
  pendingLabel: string;
  disabled?: boolean;
  variant: "secondary" | "accent";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      className="w-full"
      disabled={pending || disabled}
    >
      <Icon className="size-4" />
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
