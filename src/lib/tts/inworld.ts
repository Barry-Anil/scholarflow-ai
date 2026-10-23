import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";

const ttsResponseSchema = z.object({
  audioContent: z.string().min(1),
  usage: z
    .object({
      processedCharactersCount: z.number().int().optional(),
      modelId: z.string().optional(),
    })
    .optional(),
});

const voiceResponseSchema = z.object({
  voices: z
    .array(
      z.object({
        voiceId: z.string(),
        displayName: z.string(),
        languageCode: z.string().optional(),
        source: z.string().optional(),
      }),
    )
    .default([]),
});

type InworldConfig = {
  apiKey: string;
  modelId: "inworld-tts-2" | "inworld-tts-2-flash";
  defaultVoiceId: string;
  timeoutMs: number;
};

export async function synthesizeInworldSpeech(
  config: InworldConfig,
  input: { text: string; voiceId?: string },
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("https://api.inworld.ai/tts/v1/voice", {
    method: "POST",
    headers: {
      Authorization: `Basic ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: input.text,
      voiceId: input.voiceId || config.defaultVoiceId,
      modelId: config.modelId,
      audioConfig: { audioEncoding: "MP3" },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new AppError(
      response.status === 401 || response.status === 403
        ? "AI_AUTHORIZATION_FAILED"
        : "AI_UNAVAILABLE",
      "Inworld speech is temporarily unavailable. Use the browser voice instead.",
      { status: response.status === 429 ? 429 : 502 },
    );
  }
  const parsed = ttsResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AppError(
      "AI_RESPONSE_INVALID",
      "Inworld returned invalid audio data.",
      { status: 502 },
    );
  }
  return {
    audio: Buffer.from(parsed.data.audioContent, "base64"),
    usage: parsed.data.usage,
  };
}

export async function listInworldVoices(
  config: InworldConfig,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL("https://api.inworld.ai/voices/v1/voices");
  url.searchParams.set("pageSize", "100");
  const response = await fetcher(url, {
    headers: { Authorization: `Basic ${config.apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new AppError(
      "AI_UNAVAILABLE",
      "Inworld voices are temporarily unavailable.",
      {
        status: 502,
      },
    );
  }
  const parsed = voiceResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AppError(
      "AI_RESPONSE_INVALID",
      "Inworld returned an invalid voice list.",
      {
        status: 502,
      },
    );
  }
  return parsed.data.voices;
}
