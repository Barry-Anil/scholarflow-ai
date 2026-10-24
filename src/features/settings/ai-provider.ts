import "server-only";

import { eq, sql } from "drizzle-orm";

import { effectiveAiProvider } from "@/lib/ai/provider";
import {
  parseAiProviderChoice,
  type AiProviderChoice,
} from "@/lib/ai/provider-choice";
import { getDatabase } from "@/lib/db";
import { agentRuns, profiles } from "@/lib/db/schema";

/** The provider the user saved in Settings (`profiles.settings.aiProvider`). */
export async function getAiProviderPreference(userId: string) {
  const [row] = await getDatabase()
    .select({ choice: sql<unknown>`${profiles.settings}->>'aiProvider'` })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return parseAiProviderChoice(row?.choice);
}

/** The saved preference, downgraded to Ollama when FreeLLM is not configured. */
export async function resolveAiProvider(userId: string) {
  return effectiveAiProvider(await getAiProviderPreference(userId));
}

export async function setAiProviderPreference(
  userId: string,
  choice: AiProviderChoice,
) {
  const patch = { aiProvider: choice };
  // Merge into the JSON settings so other keys are preserved; the upsert covers
  // accounts created before the profile trigger existed.
  await getDatabase()
    .insert(profiles)
    .values({ id: userId, settings: patch })
    .onConflictDoUpdate({
      target: profiles.id,
      set: {
        settings: sql`${profiles.settings} || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * The provider snapshotted on an agent run when it was queued, so every job of
 * the run uses the same provider even if the user changes Settings mid-run.
 */
export async function getRunAiProvider(runId: string) {
  const [row] = await getDatabase()
    .select({ provider: agentRuns.provider })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  return effectiveAiProvider(parseAiProviderChoice(row?.provider));
}
