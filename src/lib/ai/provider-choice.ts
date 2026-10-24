import { z } from "zod";

// Client-safe: shared by the Settings form and the server-side provider factory.
export const aiProviderChoiceSchema = z.enum(["ollama", "freellm"]);

export type AiProviderChoice = z.infer<typeof aiProviderChoiceSchema>;

export const DEFAULT_AI_PROVIDER: AiProviderChoice = "ollama";

/** Reads a stored value, treating anything missing or unknown as the default. */
export function parseAiProviderChoice(value: unknown): AiProviderChoice {
  const parsed = aiProviderChoiceSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AI_PROVIDER;
}
