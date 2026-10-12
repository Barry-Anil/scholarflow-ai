import { Check, Copy, ExternalLink, Terminal } from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getConfigurationStatus } from "@/lib/env/server";

export default function SetupPage() {
  const status = getConfigurationStatus();
  const configured = status.ready;
  return (
    <main className="min-h-screen bg-canvas">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-6">
        <Wordmark />
        <Button asChild variant="ghost">
          <Link href="/">Back home</Link>
        </Button>
      </header>
      <div className="mx-auto max-w-3xl px-5 py-12">
        <div className="mb-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
            <Terminal className="size-3.5" /> Developer setup
          </div>
          <h1 className="font-serif text-4xl font-semibold tracking-tight">
            Connect the free-tier foundation.
          </h1>
          <p className="mt-3 max-w-2xl leading-7 text-slate-600">
            ScholarFlow never fabricates backend data when services are missing.
            Configure Supabase for accounts and persistence; AI providers remain
            optional.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              {configured
                ? "ScholarFlow foundation is configured"
                : "Supabase configuration required"}
            </CardTitle>
            <CardDescription>
              {configured
                ? "Authentication, database, and server credentials are available. You can continue to account creation."
                : "Copy the example environment file and replace placeholders with your project values."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {configured ? (
              <div className="flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm font-medium text-teal-800">
                <Check className="size-5" /> Public Supabase configuration
                detected.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-950 p-4 font-mono text-sm text-slate-100">
                  <div className="mb-2 flex items-center justify-between text-slate-400">
                    <span>PowerShell</span>
                    <Copy className="size-4" />
                  </div>
                  <code>Copy-Item .env.example .env.local</code>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">
                    Missing or invalid configuration
                  </p>
                  <p className="mt-1 break-words font-mono text-xs leading-5">
                    {status.missing.join(", ") || "Required Supabase values"}
                  </p>
                </div>
              </div>
            )}
            <ol className="space-y-3 text-sm leading-6 text-slate-600">
              <li>
                <strong className="text-slate-900">1.</strong> Create a Supabase
                project or start the local Supabase CLI.
              </li>
              <li>
                <strong className="text-slate-900">2.</strong> Add Auth,
                database, and Storage values to{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5">
                  .env.local
                </code>
                .
              </li>
              <li>
                <strong className="text-slate-900">3.</strong> Run the Drizzle
                migrations, then restart the app.
              </li>
            </ol>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild>
                <Link href={configured ? "/signup" : "/"}>
                  {configured ? "Create account" : "Review overview"}
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <a
                  href="https://supabase.com/docs/guides/local-development"
                  target="_blank"
                  rel="noreferrer"
                >
                  Supabase guide <ExternalLink className="size-4" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
