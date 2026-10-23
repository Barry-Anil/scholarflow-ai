"use client";

import type { MonitorSnapshot } from "./status-model";
import {
  Field,
  formatClock,
  formatDuration,
  formatRelative,
  Section,
  StatusBadge,
  type Tone,
} from "./monitor-ui";

const roleLabels = {
  writer: "Writer (Agent B)",
  reviewer: "Reviewer (Agent A)",
  researcher: "Researcher (Agent C)",
  embedding: "Embeddings",
} as const;

export function SystemTab({
  snapshot,
  now,
}: {
  snapshot: MonitorSnapshot;
  now: number;
}) {
  const { ollama, generation, embeddings, worker, queue, config } = snapshot;
  const ollamaTone: Tone =
    ollama.state === "reachable"
      ? "success"
      : ollama.state === "unreachable"
        ? "danger"
        : "neutral";
  const workerTone: Tone =
    worker.state === "online"
      ? "success"
      : worker.state === "unknown"
        ? "neutral"
        : "danger";
  const embeddingModel = ollama.models.find(
    (model) => model.role === "embedding",
  );

  return (
    <div className="space-y-4">
      <Section
        title="Ollama connectivity"
        description="Checked with the model tags endpoint. Reaching the server and finding a model does not prove that text generation works; see Generation below."
        action={
          <StatusBadge tone={ollamaTone}>
            {ollama.state === "reachable"
              ? "Server reachable"
              : ollama.state === "unreachable"
                ? "Unreachable"
                : "Unknown"}
          </StatusBadge>
        }
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Last checked">
            {formatRelative(ollama.checkedAt, now)}
          </Field>
          <Field label="Last successful check">
            {formatRelative(ollama.lastSuccessAt, now)}
          </Field>
          <Field label="Check latency">
            {ollama.latencyMs === null ? "—" : `${ollama.latencyMs} ms`}
          </Field>
          {ollama.errorCode && (
            <Field label="Last check error">
              <span className="font-mono text-rose-700">
                {ollama.errorCode}
              </span>
            </Field>
          )}
        </dl>
        <table className="mt-4 w-full text-left text-xs">
          <caption className="sr-only">Configured models</caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-400">
              <th scope="col" className="pb-1 font-semibold">
                Role
              </th>
              <th scope="col" className="pb-1 font-semibold">
                Model
              </th>
              <th scope="col" className="pb-1 font-semibold">
                Availability
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ollama.models.map((model) => (
              <tr key={model.role}>
                <td className="py-1.5 text-slate-600">
                  {roleLabels[model.role]}
                </td>
                <td className="py-1.5 font-mono text-slate-800">
                  {model.name}
                </td>
                <td className="py-1.5">
                  {model.installed === null ? (
                    <StatusBadge tone="neutral">Unknown</StatusBadge>
                  ) : model.installed ? (
                    <StatusBadge tone="success">Installed</StatusBadge>
                  ) : (
                    <StatusBadge tone="danger">Missing</StatusBadge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          Agent C currently retrieves evidence with keyword search and Crossref;
          it does not call the researcher model.
        </p>
      </Section>

      <Section
        title="Generation"
        description="Outcomes of real model requests recorded for this assignment."
        action={
          generation.inFlight ? (
            <StatusBadge tone="info">Request in progress</StatusBadge>
          ) : null
        }
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="In progress">
            {generation.inFlight
              ? `${generation.inFlight.model ?? "Model"} · waiting ${formatDuration(now - Date.parse(generation.inFlight.startedAt))}`
              : "No request in flight"}
          </Field>
          <Field label="Last successful generation">
            {generation.lastSuccess
              ? `${formatRelative(generation.lastSuccess.at, now)} · ${generation.lastSuccess.model}${generation.lastSuccess.latencyMs === null ? "" : ` · ${formatDuration(generation.lastSuccess.latencyMs)}`}`
              : "None recorded"}
          </Field>
          <Field label="Last failed request">
            {generation.lastFailure ? (
              <span>
                <span className="font-mono text-rose-700">
                  {generation.lastFailure.errorCode}
                </span>{" "}
                · {formatClock(generation.lastFailure.at)}
                <span className="mt-0.5 block text-slate-500">
                  {generation.lastFailure.message}
                </span>
              </span>
            ) : (
              "None recorded"
            )}
          </Field>
          <Field label="Timeout">
            {formatDuration(config.requestTimeoutMs)} per request · flagged as
            stalled after{" "}
            {formatDuration(config.requestTimeoutMs + config.modelGraceMs)}
          </Field>
        </dl>
      </Section>

      <Section
        title="Embeddings and retrieval"
        action={
          embeddings.modelInstalled === false ? (
            <StatusBadge tone="warning">Embeddings unavailable</StatusBadge>
          ) : embeddings.modelInstalled ? (
            <StatusBadge tone="success">Embedding model installed</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Unknown</StatusBadge>
          )
        }
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Embedding model">
            <span className="font-mono">{embeddingModel?.name}</span>
          </Field>
          <Field label="Course chunks embedded">
            {embeddings.embeddedChunkCount} of {embeddings.chunkCount}
          </Field>
          <Field label="Agent C retrieval">
            Keyword (PostgreSQL full-text) — operational without embeddings
          </Field>
        </dl>
      </Section>

      <Section
        title="Background worker"
        description="The worker writes a heartbeat while it runs. Its host details are never shown."
        action={
          <StatusBadge tone={workerTone}>
            {worker.state === "online"
              ? worker.busy
                ? "Online · processing"
                : "Online · idle"
              : worker.state === "stale"
                ? "Heartbeat stale"
                : worker.state === "stopped"
                  ? "Stopped"
                  : "Never reported"}
          </StatusBadge>
        }
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Last heartbeat">
            {formatRelative(worker.lastHeartbeatAt, now)}
          </Field>
          <Field label="Started">{formatClock(worker.startedAt)}</Field>
          <Field label="Stale after">
            {formatDuration(config.workerStaleMs)}
          </Field>
          {worker.stoppedAt && (
            <Field label="Stopped">{formatClock(worker.stoppedAt)}</Field>
          )}
        </dl>
      </Section>

      <Section
        title="Queue for this assignment"
        description="Agent tasks are processed one at a time across all assignments."
      >
        <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Field label="Queued">{queue.queued}</Field>
          <Field label="Running">{queue.running}</Field>
          <Field label="Retrying">{queue.retrying}</Field>
          <Field label="Completed">{queue.completed}</Field>
          <Field label="Failed">{queue.failed}</Field>
          <Field label="Cancelled">{queue.cancelled}</Field>
        </dl>
        {queue.queued > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {queue.aheadOfAssignment === 0
              ? "No other assignment's tasks are ahead in the queue."
              : `${queue.aheadOfAssignment} task${queue.aheadOfAssignment === 1 ? "" : "s"} from other assignments ${queue.aheadOfAssignment === 1 ? "is" : "are"} ahead in the queue.`}
          </p>
        )}
      </Section>
    </div>
  );
}
