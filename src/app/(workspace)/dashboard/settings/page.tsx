import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Database,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusPill, WorkspacePageHeader } from "@/components/workspace/hub-ui";
import { AiProviderForm } from "@/features/settings/ai-provider-form";
import { getSettingsHub } from "@/features/workspace/data";

export default function SettingsHubPage() {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  await connection();
  const data = await getSettingsHub();
  const services = [
    {
      label: "Supabase and database",
      ready: data.configuration.ready,
      description: data.configuration.ready
        ? "Authentication and PostgreSQL configuration are available."
        : `Missing: ${data.configuration.missing.join(", ") || "required configuration"}`,
      icon: Database,
    },
    {
      label: "Background workers",
      ready: data.workerConfigured,
      description: data.workerConfigured
        ? "Worker authentication is configured."
        : "JOB_WORKER_SECRET must contain at least 32 characters.",
      icon: LockKeyhole,
    },
    {
      label: "AI provider",
      ready: Boolean(data.ai),
      description: data.ai
        ? `Ollama${data.aiProvider.freeLlmAvailable ? " + FreeLLM" : ""} � writer ${data.ai.AI_MODEL_WRITER} � researcher ${data.ai.AI_MODEL_RESEARCHER} � reviewer ${data.ai.AI_MODEL_REVIEWER}`
        : "AI configuration contains an invalid value.",
      icon: Bot,
    },
  ];

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <WorkspacePageHeader
          eyebrow="Workspace configuration"
          title="Settings"
          description="Inspect account and runtime readiness without exposing credentials or private environment values."
        />

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              This identity owns the private workspace data shown here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 rounded-xl bg-slate-50 p-4">
              <span className="grid size-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm">
                <UserRound className="size-5" />
              </span>
              <div>
                <p className="font-semibold text-slate-900">
                  {data.user.displayName || "Student"}
                </p>
                <p className="mt-1 text-sm text-slate-500">{data.user.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI provider</CardTitle>
            <CardDescription>
              Choose which models power your research, drafting, review and
              Study Tutor requests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AiProviderForm
              current={data.aiProvider.current}
              freeLlmAvailable={data.aiProvider.freeLlmAvailable}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Service readiness</CardTitle>
            <CardDescription>
              Values are validated server-side. Secret contents are never
              rendered.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {services.map(({ label, ready, description, icon: Icon }) => (
              <div
                key={label}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center"
              >
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                    ready
                      ? "bg-teal-50 text-teal-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{label}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {description}
                  </p>
                </div>
                <StatusPill tone={ready ? "success" : "warning"}>
                  {ready ? (
                    <>
                      <CheckCircle2 className="mr-1 size-3.5" /> Ready
                    </>
                  ) : (
                    <>
                      <CircleAlert className="mr-1 size-3.5" /> Needs attention
                    </>
                  )}
                </StatusPill>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function SettingsLoading() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold text-teal-700">Settings</p>
        <div className="mt-3 h-10 w-52 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-8 h-96 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
      </div>
    </main>
  );
}
