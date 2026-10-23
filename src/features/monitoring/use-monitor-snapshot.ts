"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isActiveRun, type MonitorSnapshot } from "./status-model";

export const ACTIVE_POLL_MS = 4_000;
export const OPEN_IDLE_POLL_MS = 15_000;
export const CLOSED_IDLE_POLL_MS = 30_000;
export const MAX_BACKOFF_MS = 60_000;

export function nextPollDelay(input: {
  active: boolean;
  drawerOpen: boolean;
  consecutiveFailures: number;
}) {
  const base = input.active
    ? ACTIVE_POLL_MS
    : input.drawerOpen
      ? OPEN_IDLE_POLL_MS
      : CLOSED_IDLE_POLL_MS;
  if (!input.consecutiveFailures) return base;
  return Math.min(MAX_BACKOFF_MS, base * 2 ** input.consecutiveFailures);
}

export type MonitorFetchState = {
  snapshot: MonitorSnapshot | null;
  error: string | null;
  lastSuccessAt: number | null;
  loading: boolean;
};

/**
 * Polls the read-only monitor endpoint. Requests never overlap, are aborted on
 * unmount, pause while the tab is hidden, and back off after failures. The
 * last good snapshot is kept but reported as stale rather than discarded.
 */
export function useMonitorSnapshot(assignmentId: string, drawerOpen: boolean) {
  const [state, setState] = useState<MonitorFetchState>({
    snapshot: null,
    error: null,
    lastSuccessAt: null,
    loading: true,
  });
  const failuresRef = useRef(0);
  const activeRef = useRef(false);
  const drawerOpenRef = useRef(drawerOpen);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    drawerOpenRef.current = drawerOpen;
    // Opening the drawer should show fresh data immediately.
    if (drawerOpen) refreshRef.current();
  }, [drawerOpen]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const schedule = () => {
      window.clearTimeout(timer);
      if (disposed || document.visibilityState === "hidden") return;
      timer = window.setTimeout(
        poll,
        nextPollDelay({
          active: activeRef.current,
          drawerOpen: drawerOpenRef.current,
          consecutiveFailures: failuresRef.current,
        }),
      );
    };

    async function poll() {
      if (disposed || controller) return;
      window.clearTimeout(timer);
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/assignments/${assignmentId}/monitor`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = (await response.json().catch(() => null)) as
          (MonitorSnapshot & { message?: string }) | null;
        if (!response.ok || !body) {
          throw new Error(
            body?.message ?? `The monitor responded with ${response.status}.`,
          );
        }
        failuresRef.current = 0;
        activeRef.current = body.runs.some(isActiveRun);
        if (!disposed) {
          setState({
            snapshot: body,
            error: null,
            lastSuccessAt: Date.now(),
            loading: false,
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        failuresRef.current += 1;
        if (!disposed) {
          setState((current) => ({
            ...current,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "The monitor could not be reached.",
          }));
        }
      } finally {
        controller = null;
        schedule();
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
      else window.clearTimeout(timer);
    };

    refreshRef.current = () => void poll();
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      refreshRef.current = () => undefined;
    };
  }, [assignmentId]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { ...state, refresh };
}
