"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-[calc(100vh-4.5rem)] place-items-center p-5 lg:p-8">
      <Card className="w-full max-w-lg">
        <CardContent className="p-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-rose-50 text-rose-700">
            <AlertTriangle className="size-6" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">
            Workspace data is unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            ScholarFlow could not load your persisted workspace. Check the
            database connection or try again in a moment.
          </p>
          {error.digest && (
            <p className="mt-3 font-mono text-xs text-slate-400">
              Reference: {error.digest}
            </p>
          )}
          <Button className="mt-6" onClick={reset}>
            <RefreshCw className="size-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
