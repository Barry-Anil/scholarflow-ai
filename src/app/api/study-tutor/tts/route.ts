import { NextResponse } from "next/server";
import { z } from "zod";

import { getOptionalUser } from "@/lib/auth/session";
import { getTtsEnv } from "@/lib/env/server";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import { listInworldVoices, synthesizeInworldSpeech } from "@/lib/tts/inworld";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  voiceId: z.string().trim().min(1).max(160).optional(),
});

function config() {
  const env = getTtsEnv();
  if (!env.INWORLD_API_KEY) {
    throw new AppError(
      "CONFIGURATION_MISSING",
      "Inworld speech is not configured. Use the browser voice instead.",
      { status: 503 },
    );
  }
  return {
    apiKey: env.INWORLD_API_KEY,
    modelId: env.INWORLD_TTS_MODEL,
    defaultVoiceId: env.INWORLD_TTS_VOICE_ID,
    timeoutMs: env.INWORLD_TTS_TIMEOUT_MS,
  };
}

export async function GET() {
  const user = await getOptionalUser();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to list voices." },
      { status: 401 },
    );
  const env = getTtsEnv();
  if (!env.INWORLD_API_KEY)
    return NextResponse.json({ configured: false, voices: [] });
  try {
    const voices = await listInworldVoices(config());
    return NextResponse.json({ configured: true, voices });
  } catch (error) {
    logger.warn("study.tts_voices_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    return NextResponse.json(
      { configured: true, voices: [], error: safeErrorMessage(error) },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getOptionalUser();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to generate speech." },
      { status: 401 },
    );
  try {
    await enforceUserRateLimit(user.id, "study.tts");
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(
        "INVALID_INPUT",
        "Speech text must be between 1 and 2,000 characters.",
        {
          status: 400,
        },
      );
    }
    const result = await synthesizeInworldSpeech(config(), parsed.data);
    return new Response(result.audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
        "Content-Length": String(result.audio.byteLength),
      },
    });
  } catch (error) {
    logger.error("study.tts_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: error instanceof AppError ? error.status : 502 },
    );
  }
}
