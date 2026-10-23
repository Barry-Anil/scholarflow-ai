"use client";

import { Activity, Bot, GitCompare, Server } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { AgentsTab } from "./agents-tab";
import { ChangesTab } from "./changes-tab";
import { formatRelative, useNow } from "./monitor-ui";
import {
  analyzeSnapshot,
  latestFailureAt,
  type OverallState,
} from "./status-model";
import { SystemTab } from "./system-tab";
import { nextPollDelay, useMonitorSnapshot } from "./use-monitor-snapshot";

type MonitorTab = "system" | "agents" | "changes";

const tabs: Array<{ id: MonitorTab; label: string; icon: typeof Server }> = [
  { id: "system", label: "System", icon: Server },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "changes", label: "Changes & Evaluation", icon: GitCompare },
];

const stateStyles: Record<OverallState, string> = {
  Running: "bg-sky-100 text-sky-800",
  Waiting: "bg-amber-100 text-amber-800",
  Stalled: "bg-rose-100 text-rose-700",
  Failed: "bg-rose-100 text-rose-700",
  Offline: "bg-slate-200 text-slate-700",
  Completed: "bg-teal-100 text-teal-800",
  Idle: "bg-slate-100 text-slate-600",
  Unknown: "bg-slate-100 text-slate-500",
};

function seenKey(assignmentId: string) {
  return `scholarflow:monitor-seen:${assignmentId}`;
}

function readSeen(assignmentId: string) {
  try {
    return window.localStorage.getItem(seenKey(assignmentId));
  } catch {
    return null;
  }
}

const seenListeners = new Set<() => void>();

function subscribeSeen(listener: () => void) {
  seenListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    seenListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writeSeen(assignmentId: string, stamp: string) {
  try {
    window.localStorage.setItem(seenKey(assignmentId), stamp);
  } catch {
    // Storage can be unavailable; the indicator then simply stays visible.
  }
  seenListeners.forEach((listener) => listener());
}

export function AgentMonitor({
  courseId,
  assignmentId,
}: {
  courseId: string;
  assignmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<MonitorTab>("agents");
  const { snapshot, error, lastSuccessAt, loading, refresh } =
    useMonitorSnapshot(assignmentId, open);
  const now = useNow(1_000);
  const analysis = useMemo(
    () => (snapshot ? analyzeSnapshot(snapshot, now) : null),
    [snapshot, now],
  );
  const overall = analysis?.overall ?? {
    state: "Unknown" as const,
    activeAgents: 0,
    activeJobs: 0,
  };

  // Last time the reader opened the monitor; a newer failure shows a dot.
  // Only a timestamp is stored, never monitoring data.
  const seenAt = useSyncExternalStore(
    subscribeSeen,
    () => readSeen(assignmentId),
    () => null,
  );
  const failureAt = snapshot ? latestFailureAt(snapshot) : null;
  const unseenFailure = Boolean(failureAt && (!seenAt || failureAt > seenAt));
  useEffect(() => {
    if (open && snapshot) writeSeen(assignmentId, snapshot.generatedAt);
  }, [open, snapshot, assignmentId]);

  const stale =
    error !== null ||
    (lastSuccessAt !== null &&
      now - lastSuccessAt >
        2 *
          nextPollDelay({
            active: overall.activeAgents > 0,
            drawerOpen: open,
            consecutiveFailures: 0,
          }) +
          5_000);

  const buttonLabel = [
    `Open agent monitor. Status: ${overall.state}.`,
    overall.activeJobs
      ? `${overall.activeJobs} active task${overall.activeJobs === 1 ? "" : "s"}.`
      : "",
    unseenFailure ? "A new failure needs attention." : "",
    stale ? "Status may be out of date." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className="pointer-events-none sticky top-3 z-30 flex justify-end pr-[env(safe-area-inset-right)]">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={buttonLabel}
          data-testid="agent-monitor-trigger"
          className="pointer-events-auto relative flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-2.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur-md transition hover:border-teal-400 focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-hidden sm:px-3"
        >
          <Activity
            className={cn(
              "size-4 text-teal-600",
              overall.state === "Running" && "motion-safe:animate-pulse",
            )}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Agent monitor</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px]",
              stateStyles[overall.state],
            )}
            aria-hidden="true"
          >
            {loading && !snapshot ? "Loading" : overall.state}
          </span>
          {overall.activeJobs > 0 && (
            <span
              className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] text-white tabular-nums"
              aria-hidden="true"
            >
              {overall.activeJobs}
            </span>
          )}
          {unseenFailure && (
            <span
              className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-rose-500 ring-2 ring-white"
              aria-hidden="true"
            />
          )}
        </button>
      </div>
      {/* Announces state changes, not every poll. */}
      <p className="sr-only" role="status" aria-live="polite">
        {snapshot ? `Agent monitor status: ${overall.state}` : ""}
      </p>

      <Drawer
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Agent monitor"
        description="Live status from persisted jobs, agent events, worker heartbeats, and Ollama checks."
        widthClassName="w-full sm:w-[min(44rem,calc(100vw-2rem))]"
        returnFocusRef={triggerRef}
        headerActions={<MonitorTabs value={tab} onChange={setTab} />}
      >
        {stale && snapshot && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            {error
              ? `Updates are failing (${error}). Showing data from ${formatRelative(new Date(lastSuccessAt ?? now).toISOString(), now)}; retrying with backoff.`
              : `Last updated ${formatRelative(new Date(lastSuccessAt ?? now).toISOString(), now)}.`}
          </p>
        )}
        {!snapshot ? (
          error ? (
            <p
              role="alert"
              className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
            >
              The monitor could not load: {error}
            </p>
          ) : (
            <p className="text-sm text-slate-500">Loading monitor…</p>
          )
        ) : (
          <div
            role="tabpanel"
            id={`monitor-panel-${tab}`}
            aria-labelledby={`monitor-tab-${tab}`}
          >
            {tab === "system" && <SystemTab snapshot={snapshot} now={now} />}
            {tab === "agents" && analysis && (
              <AgentsTab
                courseId={courseId}
                assignmentId={assignmentId}
                snapshot={snapshot}
                analyses={analysis.runs}
                now={now}
                onRunChanged={refresh}
              />
            )}
            {tab === "changes" && <ChangesTab assignmentId={assignmentId} />}
          </div>
        )}
      </Drawer>
    </>
  );
}

function MonitorTabs({
  value,
  onChange,
}: {
  value: MonitorTab;
  onChange: (tab: MonitorTab) => void;
}) {
  const labelId = useId();
  const refs = useRef<Record<MonitorTab, HTMLButtonElement | null>>({
    system: null,
    agents: null,
    changes: null,
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((item) => item.id === value);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next]!.id;
    onChange(target);
    refs.current[target]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-labelledby={labelId}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1"
    >
      <span id={labelId} className="sr-only">
        Monitor sections
      </span>
      {tabs.map((item) => {
        const Icon = item.icon;
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(element) => {
              refs.current[item.id] = element;
            }}
            type="button"
            role="tab"
            id={`monitor-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`monitor-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-hidden",
              selected
                ? "bg-teal-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
