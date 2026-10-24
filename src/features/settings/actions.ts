"use server";

import { revalidatePath } from "next/cache";

import { isFreeLlmConfigured } from "@/lib/ai/provider";
import { aiProviderChoiceSchema } from "@/lib/ai/provider-choice";
import { requireUser } from "@/lib/auth/session";
import { errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import { setAiProviderPreference } from "./ai-provider";

export type AiProviderActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export async function updateAiProviderAction(
  _state: AiProviderActionState,
  formData: FormData,
): Promise<AiProviderActionState> {
  const user = await requireUser();
  const parsed = aiProviderChoiceSchema.safeParse(formData.get("provider"));
  if (!parsed.success) {
    return { status: "error", message: "Choose a valid AI provider." };
  }
  if (parsed.data === "freellm" && !isFreeLlmConfigured()) {
    return {
      status: "error",
      message: "FreeLLM is not configured on this server yet.",
    };
  }

  try {
    await enforceUserRateLimit(user.id, "settings.update");
    await setAiProviderPreference(user.id, parsed.data);
    logger.info("settings.ai_provider_updated", {
      userId: user.id,
      provider: parsed.data,
    });
    revalidatePath("/dashboard/settings");
    return {
      status: "success",
      message:
        parsed.data === "freellm"
          ? "New AI requests will use FreeLLM."
          : "New AI requests will use Ollama.",
    };
  } catch (error) {
    logger.error("settings.ai_provider_update_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    return { status: "error", message: safeErrorMessage(error) };
  }
}
