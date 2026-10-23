"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  RotateCcw,
  Square,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import AILoadingState from "@/components/kokonutui/ai-loading";
import { Button } from "@/components/ui/button";
import {
  retryAgentRunAction,
  stopAgentRunAction,
  type RunControlResult,
} from "@/features/agents/actions";
import { cn } from "@/lib/utils";
import {
  CopyableId,
  DeterminateProgress,
  EmptyState,
  Field,
  formatClock,
  formatDuration,
  formatRelative,
  IndeterminateProgress,
  StatusBadge,
  type Tone,
} from "./monitor-ui";
import {
  agentProfiles,
  isActiveRun,
  monitorAgentOrder,
  runStateLabel,
  type EventSeverity,
  type MonitorAgentKey,
  type MonitorEvent,
  type MonitorSnapshot,
  type RunAnalysis,
  type RunState,
} from "./status-model";

export function AgentsTab({
  courseId,
  assignmentId,
  snapshot,
  analyses,
  now,
  onRunChanged,
}: {
  courseId: string;
  assignmentId: string;
  snapshot: MonitorSnapshot;
  analyses: Map<MonitorAgentKey, RunAnalysis>;
  now: number;
  onRunChanged: () => void;
}) {
  return (
    <div className="space-y-4">
      {monitorAgentOrder.map((agent) => (
        <AgentCard
          key={agent}
          agent={agent}
          analysis={analyses.get(agent) ?? null}
          canEdit={snapshot.canEdit}
          now={now}
          controls={{ courseId, assignmentId, onRunChanged }}
        />
      ))}
      <EventHistory
        assignmentId={assignmentId}
        refreshKey={snapshot.generatedAt}
        now={now}
      />
    </div>
  );
}

function runTone(state: RunState): Tone {
  if (state === "completed") return "success";
  if (state === "failed" || state === "potentially_stalled") return "danger";
  if (state === "cancelled") return "neutral";
  if (state === "running" || state === "finalizing") return "info";
  return "warning";
}

type RunControlContext = {
  courseId: string;
  assignmentId: string;
  onRunChanged: () => void;
};

function AgentCard({
  agent,
  analysis,
  canEdit,
  now,
  controls,
}: {
  agent: MonitorAgentKey;
  analysis: RunAnalysis | null;
  canEdit: boolean;
  now: number;
  controls: RunControlContext;
}) {
  const profile = agentProfiles[agent];
  const active = analysis ? isActiveRun(analysis.run) : false;
  const [expanded, setExpanded] = useState(active);
  const panelId = `agent-${agent}-details`;

  if (!analysis) {
    return (
      <article className="rounded-2xl border border-slate-200 bg-white p-4">
        <AgentHeading
          agent={agent}
          badge={<StatusBadge tone="neutral">Idle</StatusBadge>}
        />
        <p className="mt-3 text-xs text-slate-500">
          No {profile.label} run has been recorded for this assignment.
        </p>
      </article>
    );
  }

  const { run, progress, state } = analysis;
  const elapsedFrom = run.startedAt ?? null;
  const elapsedTo = run.completedAt ? Date.parse(run.completedAt) : now;
  const currentJob = analysis.currentJob;
  const percent = progress.percent;

  return (
    <article
      className={cn(
        "rounded-2xl border bg-white p-4",
        state === "failed" || state === "potentially_stalled"
          ? "border-rose-200"
          : active
            ? "border-sky-200"
            : "border-slate-200",
      )}
      aria-label={`${profile.label} ${profile.role}`}
    >
      <AgentHeading
        agent={agent}
        badge={
          <StatusBadge tone={runTone(state)}>
            {runStateLabel(state)}
          </StatusBadge>
        }
      />

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Run">
          <CopyableId label={`${profile.label} run ID`} value={run.id} />
        </Field>
        <Field label="Current stage">{analysis.currentStage}</Field>
        <Field label="Model">
          <span className="font-mono">{run.model ?? run.provider ?? "—"}</span>
        </Field>
        <Field label="Started">
          {run.startedAt ? formatClock(run.startedAt) : "Not started"}
        </Field>
        <Field label="Elapsed">
          {elapsedFrom
            ? formatDuration(elapsedTo - Date.parse(elapsedFrom))
            : "—"}
        </Field>
        <Field label="Last activity">
          {formatRelative(analysis.lastActivityAt, now)}
        </Field>
        {currentJob && (
          <>
            <Field label="Current task">
              <span className="flex flex-wrap items-center gap-1">
                Question {currentJob.questionNumber ?? "?"}
                <CopyableId label="job ID" value={currentJob.id} />
              </span>
            </Field>
            <Field label="Attempt">
              {Math.max(currentJob.attempts, 1)} of {currentJob.maxAttempts}
              {currentJob.attempts > 1
                ? ` · ${currentJob.attempts - 1} retried`
                : ""}
            </Field>
          </>
        )}
      </dl>

      <div className="mt-4 space-y-3">
        {percent !== null ? (
          <DeterminateProgress
            label={`${profile.label} progress`}
            percent={percent}
            tone={
              state === "failed"
                ? "danger"
                : state === "potentially_stalled"
                  ? "warning"
                  : "success"
            }
            caption={`${progress.completedMilestones} of ${progress.totalMilestones} milestones saved (${run.jobs.length} question task${run.jobs.length === 1 ? "" : "s"} + final save). Counts only persisted output.`}
          />
        ) : (
          <IndeterminateProgress
            label={`${profile.label} progress`}
            active={active}
            caption="No per-question tasks recorded for this run."
          />
        )}
        {active && currentJob?.status === "processing" && (
          <IndeterminateProgress
            label={`Question ${currentJob.questionNumber ?? "?"}: ${analysis.currentStage.split(" · ").at(-1)}`}
            active={state === "running"}
            caption={
              analysis.currentJobStartedAt
                ? `Running for ${formatDuration(now - Date.parse(analysis.currentJobStartedAt))}. The model reports no partial progress, so no percentage is shown.`
                : "No stage reported yet for this attempt."
            }
          />
        )}
      </div>

      {analysis.currentReason &&
        (state === "potentially_stalled" ||
          state === "retry_scheduled" ||
          state === "waiting_worker") && (
          <p
            className={cn(
              "mt-3 rounded-xl px-3 py-2 text-xs leading-5",
              state === "potentially_stalled"
                ? "bg-rose-50 text-rose-700"
                : "bg-amber-50 text-amber-800",
            )}
          >
            {analysis.currentReason}
          </p>
        )}

      {run.status === "cancelled" && (
        <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-700">
          {run.errorMessage ?? "This run was stopped."} Saved tasks are kept;
          retrying re-queues only the unfinished ones.
        </p>
      )}

      {run.status === "failed" && (
        <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
          <p className="font-semibold">
            {run.errorCode ? `${run.errorCode}: ` : ""}
            {run.errorMessage ?? "The run failed."}
          </p>
          <p className="mt-1 text-rose-600">
            {recoveryHint(run.errorCode, profile.label, canEdit)}
          </p>
        </div>
      )}

      {canEdit && (
        <RunControls
          key={`${run.id}:${run.status}`}
          label={profile.label}
          run={run}
          stalled={state === "potentially_stalled"}
          {...controls}
        />
      )}

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="mt-3 flex items-center gap-1 rounded-lg px-1 py-1 text-xs font-semibold text-teal-700 hover:text-teal-900 focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-hidden"
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
        {expanded ? "Hide task details" : "Show task details"}
      </button>
      {expanded && (
        <div
          id={panelId}
          className="mt-2 space-y-3 rounded-xl bg-slate-50/70 p-3"
        >
          <AILoadingState
            steps={analysis.steps}
            startedAt={run.startedAt ? Date.parse(run.startedAt) : undefined}
            endedAt={run.completedAt ? Date.parse(run.completedAt) : undefined}
            idleTitle={analysis.currentReason ?? analysis.currentStage}
            collapseWhenDone={false}
            className="justify-start [&>div>div]:max-w-none"
          />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Latest events
            </p>
            {run.events.length ? (
              <ol className="mt-1 space-y-1">
                {run.events.slice(0, 5).map((event) => (
                  <li
                    key={event.id}
                    className="flex gap-2 text-xs text-slate-600"
                  >
                    <SeverityIcon severity={event.severity} />
                    <span className="min-w-0 flex-1">{event.message}</span>
                    <time
                      className="shrink-0 text-slate-400"
                      dateTime={event.createdAt}
                    >
                      {formatRelative(event.createdAt, now)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-xs text-slate-500">No events recorded.</p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function RunControls({
  label,
  run,
  stalled,
  courseId,
  assignmentId,
  onRunChanged,
}: RunControlContext & {
  label: string;
  run: RunAnalysis["run"];
  stalled: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RunControlResult | null>(null);
  const active = isActiveRun(run);
  const unfinished = run.jobs.filter(
    (job) => job.status !== "completed",
  ).length;

  if (!active && !run.retryable) {
    return run.status === "failed" || run.status === "cancelled" ? (
      <p className="mt-3 text-xs text-slate-500">
        A newer run exists, so this one cannot be retried. Start a new run from
        the Agents panel.
      </p>
    ) : null;
  }

  const execute = (
    action: (
      courseId: string,
      assignmentId: string,
      runId: string,
    ) => Promise<RunControlResult>,
  ) =>
    startTransition(async () => {
      const outcome = await action(courseId, assignmentId, run.id);
      setResult(outcome);
      setConfirming(false);
      if (outcome.ok) {
        onRunChanged();
        router.refresh();
      }
    });

  return (
    <div className="mt-3 space-y-2">
      {active && !confirming && (
        <Button
          type="button"
          size="sm"
          variant={stalled ? "primary" : "secondary"}
          onClick={() => setConfirming(true)}
          disabled={pending}
        >
          <Square className="size-3.5" aria-hidden="true" /> Stop run
        </Button>
      )}
      {active && confirming && (
        <div
          role="group"
          aria-label={`Confirm stopping ${label}`}
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <p>
            Stop {label}? Saved tasks are kept and {unfinished} unfinished task
            {unfinished === 1 ? " is" : "s are"} cancelled. A model request
            already in progress finishes in the background but is not saved as
            completion.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() => execute(stopAgentRunAction)}
            >
              {pending ? "Stopping…" : "Confirm stop"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Keep running
            </Button>
          </div>
        </div>
      )}
      {!active && run.retryable && (
        <Button
          type="button"
          size="sm"
          variant="accent"
          disabled={pending}
          onClick={() => execute(retryAgentRunAction)}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {pending
            ? "Re-queuing…"
            : `Retry ${unfinished || 1} unfinished task${unfinished === 1 || !unfinished ? "" : "s"}`}
        </Button>
      )}
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={cn(
            "text-xs",
            result.ok ? "text-teal-700" : "text-rose-700",
          )}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}

function AgentHeading({
  agent,
  badge,
}: {
  agent: MonitorAgentKey;
  badge: React.ReactNode;
}) {
  const profile = agentProfiles[agent];
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          {profile.label} · {profile.role}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {profile.responsibility}
        </p>
      </div>
      {badge}
    </div>
  );
}

export function recoveryHint(
  code: string | null,
  label: string,
  canEdit: boolean,
) {
  const restart = canEdit
    ? `start ${label} again from the Agents panel`
    : "ask an editor to start it again";
  if (code === "AI_TIMEOUT") {
    return `The model did not answer within the timeout. Check the System tab, then ${restart}.`;
  }
  if (code === "AI_UNAVAILABLE") {
    return `Ollama was unreachable or the model is missing. Check the System tab, then ${restart}.`;
  }
  if (code === "AI_RESPONSE_INVALID") {
    return `The model's output failed schema validation, so nothing was saved for that task. You can ${restart}; if it repeats, a more capable model may be needed.`;
  }
  if (code === "AI_AUTHORIZATION_FAILED") {
    return "The Ollama access credentials were rejected. An administrator must fix the server configuration.";
  }
  if (code === "DATABASE_UNAVAILABLE") {
    return `Saving to the database failed. Once it is available, ${restart}.`;
  }
  return `Review the event history, then ${restart}.`;
}

function SeverityIcon({ severity }: { severity: EventSeverity }) {
  if (severity === "failure") {
    return (
      <XCircle
        className="mt-0.5 size-3.5 shrink-0 text-rose-600"
        aria-label="Failure"
      />
    );
  }
  if (severity === "warning") {
    return (
      <AlertTriangle
        className="mt-0.5 size-3.5 shrink-0 text-amber-600"
        aria-label="Warning"
      />
    );
  }
  if (severity === "success") {
    return (
      <CheckCircle2
        className="mt-0.5 size-3.5 shrink-0 text-teal-600"
        aria-label="Success"
      />
    );
  }
  return (
    <Info
      className="mt-0.5 size-3.5 shrink-0 text-slate-400"
      aria-label="Information"
    />
  );
}

type EventPage = { events: MonitorEvent[]; nextCursor: string | null };

function EventHistory({
  assignmentId,
  refreshKey,
  now,
}: {
  assignmentId: string;
  refreshKey: string;
  now: number;
}) {
  const [agent, setAgent] = useState("");
  const [severity, setSeverity] = useState("");
  const [sinceHours, setSinceHours] = useState("");
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const query = (cursor?: string) => {
    const params = new URLSearchParams({ limit: "25" });
    if (agent) params.set("agent", agent);
    if (severity) params.set("severity", severity);
    if (sinceHours) params.set("sinceHours", sinceHours);
    if (cursor) params.set("cursor", cursor);
    return `/api/assignments/${assignmentId}/monitor/events?${params}`;
  };

  // Reload the first page when filters change, and follow live updates only
  // while the reader has not paged further back.
  const followLive = pages === 1;
  useEffect(() => {
    if (!followLive) return;
    const controller = new AbortController();
    fetch(query(), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const page = (await response.json()) as EventPage;
        setEvents(page.events);
        setNextCursor(page.nextCursor);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setStatus("error");
        }
      });
    return () => controller.abort();
    // query() reads the filter state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, agent, severity, sinceHours, refreshKey, followLive]);

  const loadMore = async () => {
    if (!nextCursor) return;
    try {
      const response = await fetch(query(nextCursor), { cache: "no-store" });
      if (!response.ok) throw new Error();
      const page = (await response.json()) as EventPage;
      setEvents((current) => [...current, ...page.events]);
      setNextCursor(page.nextCursor);
      setPages((count) => count + 1);
    } catch {
      setStatus("error");
    }
  };

  const resetPaging = () => setPages(1);
  const selectClass =
    "h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-hidden";

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4"
      aria-labelledby="event-history-title"
    >
      <h3
        id="event-history-title"
        className="text-sm font-semibold text-slate-900"
      >
        Event history
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Every event is read from the persisted agent event log.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="event-agent">
          Agent
        </label>
        <select
          id="event-agent"
          className={selectClass}
          value={agent}
          onChange={(e) => {
            setAgent(e.target.value);
            resetPaging();
          }}
        >
          <option value="">All agents</option>
          {monitorAgentOrder.map((key) => (
            <option key={key} value={key}>
              {agentProfiles[key].label} · {agentProfiles[key].role}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="event-severity">
          Severity
        </label>
        <select
          id="event-severity"
          className={selectClass}
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            resetPaging();
          }}
        >
          <option value="">All severities</option>
          <option value="failure">Failures</option>
          <option value="warning">Warnings</option>
          <option value="success">Successes</option>
          <option value="info">Information</option>
        </select>
        <label className="sr-only" htmlFor="event-since">
          Time range
        </label>
        <select
          id="event-since"
          className={selectClass}
          value={sinceHours}
          onChange={(e) => {
            setSinceHours(e.target.value);
            resetPaging();
          }}
        >
          <option value="">Any time</option>
          <option value="1">Last hour</option>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
        </select>
      </div>

      {status === "error" && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700"
        >
          The event history could not be loaded. It will retry with the next
          update.
        </p>
      )}
      {status === "loading" && (
        <p className="mt-3 text-xs text-slate-500">Loading events…</p>
      )}
      {status !== "loading" && !events.length && (
        <div className="mt-3">
          <EmptyState>No events match these filters.</EmptyState>
        </div>
      )}
      <ol className="mt-3 space-y-1.5">
        {events.map((event) => (
          <EventRow key={event.id} event={event} now={now} />
        ))}
      </ol>
      {nextCursor && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => void loadMore()}
        >
          Load older events
        </Button>
      )}
    </section>
  );
}

function EventRow({ event, now }: { event: MonitorEvent; now: number }) {
  const [open, setOpen] = useState(false);
  const label =
    event.agent === "system" ? "System" : agentProfiles[event.agent].label;
  const latency =
    typeof event.metadata.latencyMs === "number"
      ? event.metadata.latencyMs
      : null;
  const details = Object.entries(event.metadata);
  return (
    <li className="rounded-xl border border-slate-100 px-3 py-2">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-hidden"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <SeverityIcon severity={event.severity} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-slate-700">{event.message}</span>
          <span className="mt-0.5 block text-[11px] text-slate-400">
            {label} · <span className="font-mono">{event.eventType}</span>
            {latency !== null ? ` · ${formatDuration(latency)}` : ""}
          </span>
        </span>
        <time
          className="shrink-0 text-[11px] text-slate-400"
          dateTime={event.createdAt}
          title={formatClock(event.createdAt)}
        >
          {formatRelative(event.createdAt, now)}
        </time>
      </button>
      {open && (
        <dl className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2">
          <Field label="Time">{formatClock(event.createdAt)}</Field>
          <Field label="Run">
            <CopyableId label="run ID" value={event.runId} />
          </Field>
          {details.map(([key, value]) => (
            <Field key={key} label={key}>
              {key === "jobId" && typeof value === "string" ? (
                <CopyableId label="job ID" value={value} />
              ) : (
                <span className="font-mono break-all">{String(value)}</span>
              )}
            </Field>
          ))}
        </dl>
      )}
    </li>
  );
}
