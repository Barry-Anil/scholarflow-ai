"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { backfillEmbeddingsAction, type KnowledgeActionState } from "./actions";

const initialState: KnowledgeActionState = { status: "idle" };

export function EmbeddingBackfillForm({
  courseId,
  remaining,
}: {
  courseId: string;
  remaining: number;
}) {
  const [state, action, pending] = useActionState(
    backfillEmbeddingsAction.bind(null, courseId),
    initialState,
  );

  return (
    <form action={action} className="flex flex-col gap-3 sm:items-end">
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        {pending ? "Generating embeddings…" : "Generate missing embeddings"}
      </Button>
      <p
        className={
          state.status === "error"
            ? "max-w-md text-xs font-medium text-rose-600"
            : "max-w-md text-xs text-slate-500"
        }
        role="status"
        aria-live="polite"
      >
        {state.message ??
          `${remaining} chunk${remaining === 1 ? "" : "s"} will be processed in bounded batches of 32.`}
      </p>
    </form>
  );
}
