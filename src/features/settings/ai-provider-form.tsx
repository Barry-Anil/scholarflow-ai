"use client";

import { CloudCog, Server, ShieldAlert } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import type { AiProviderChoice } from "@/lib/ai/provider-choice";
import { updateAiProviderAction, type AiProviderActionState } from "./actions";

const initialState: AiProviderActionState = { status: "idle" };

const options = [
  {
    value: "ollama",
    label: "Ollama",
    description:
      "Self-hosted models on the ScholarFlow server. Your course text stays on infrastructure we run.",
    icon: Server,
  },
  {
    value: "freellm",
    label: "FreeLLM",
    description:
      "Hosted cloud models through the FreeLLM API. Often faster when the self-hosted model is busy or loading.",
    icon: CloudCog,
  },
] as const satisfies ReadonlyArray<{
  value: AiProviderChoice;
  label: string;
  description: string;
  icon: typeof Server;
}>;

export function AiProviderForm({
  current,
  freeLlmAvailable,
}: {
  current: AiProviderChoice;
  freeLlmAvailable: boolean;
}) {
  const [state, action, pending] = useActionState(
    updateAiProviderAction,
    initialState,
  );
  const [selected, setSelected] = useState<AiProviderChoice>(current);

  return (
    <form action={action} className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">AI provider</legend>
        {options.map(({ value, label, description, icon: Icon }) => {
          const disabled = value === "freellm" && !freeLlmAvailable;
          const checked = selected === value;
          return (
            <label
              key={value}
              className={`flex gap-3 rounded-xl border p-4 transition-colors ${
                disabled
                  ? "cursor-not-allowed border-slate-200 bg-slate-50/70 opacity-60"
                  : checked
                    ? "cursor-pointer border-teal-500 bg-teal-50/60"
                    : "cursor-pointer border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="provider"
                value={value}
                checked={checked}
                disabled={disabled}
                onChange={() => setSelected(value)}
                className="mt-1 size-4 accent-teal-600"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold text-slate-800">
                  <Icon className="size-4 text-slate-500" />
                  {label}
                </span>
                <span className="mt-1 block text-sm leading-6 text-slate-500">
                  {disabled
                    ? "Not configured on this server. Ask an administrator to set the FreeLLM API variables."
                    : description}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {selected === "freellm" && (
        <div
          role="note"
          className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            With FreeLLM, your course materials, questions and drafts are sent
            to third-party cloud model providers. Choose Ollama if this content
            must stay on the ScholarFlow server.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          If your chosen provider is down or times out, the other one is used
          automatically. Agent runs already in progress keep their provider.
        </p>
        <Button
          type="submit"
          variant="accent"
          disabled={pending || selected === current}
        >
          {pending ? "Saving…" : "Save provider"}
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
