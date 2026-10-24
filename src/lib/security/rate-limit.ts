import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";

export const RATE_LIMIT_POLICIES = {
  "auth.login": { limit: 10, windowMs: 15 * 60_000 },
  "auth.signup": { limit: 5, windowMs: 60 * 60_000 },
  "auth.password-reset": { limit: 5, windowMs: 60 * 60_000 },
  "auth.password-update": { limit: 5, windowMs: 60 * 60_000 },
  "course.create": { limit: 20, windowMs: 60 * 60_000 },
  "settings.update": { limit: 30, windowMs: 60 * 60_000 },
  "course.membership": { limit: 30, windowMs: 60 * 60_000 },
  "knowledge.upload": { limit: 10, windowMs: 60 * 60_000 },
  "knowledge.retry": { limit: 30, windowMs: 60 * 60_000 },
  "knowledge.embed": { limit: 30, windowMs: 60 * 60_000 },
  "study.upload": { limit: 10, windowMs: 60 * 60_000 },
  "study.ai": { limit: 60, windowMs: 60 * 60_000 },
  "study.tts": { limit: 120, windowMs: 60 * 60_000 },
  "study.mutate": { limit: 120, windowMs: 60 * 60_000 },
  "assignment.create": { limit: 20, windowMs: 60 * 60_000 },
  "assignment.save": { limit: 120, windowMs: 60 * 60_000 },
  "agent.enqueue": { limit: 30, windowMs: 60 * 60_000 },
  "review.decision": { limit: 120, windowMs: 60 * 60_000 },
  "approval.create": { limit: 20, windowMs: 60 * 60_000 },
  "export.enqueue": { limit: 30, windowMs: 60 * 60_000 },
  "worker.agent": { limit: 180, windowMs: 60_000 },
  "worker.export": { limit: 60, windowMs: 60_000 },
  "export.download": { limit: 60, windowMs: 60_000 },
} as const;

export type RateLimitScope = keyof typeof RATE_LIMIT_POLICIES;

export function rateLimitActor(namespace: "auth" | "user", value: string) {
  const normalized = value.trim().toLowerCase();
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(normalized)
    .digest("hex");
  return `${namespace}:${digest}`;
}

export function rateLimitWindow(nowMs: number, windowMs: number) {
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  return {
    start: new Date(startMs),
    expiresAt: new Date(startMs + windowMs),
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((startMs + windowMs - nowMs) / 1_000),
    ),
  };
}

export async function enforceRateLimit(
  actorKey: string,
  scope: RateLimitScope,
  now = new Date(),
) {
  const policy = RATE_LIMIT_POLICIES[scope];
  const window = rateLimitWindow(now.getTime(), policy.windowMs);
  const result = await getDatabase().execute<{ count: number }>(sql`
    with cleanup as (
      delete from rate_limit_counters
      where actor_key = ${actorKey}
        and expires_at <= ${now.toISOString()}::timestamptz
    )
    insert into rate_limit_counters (
      actor_key,
      scope,
      window_start,
      count,
      expires_at,
      updated_at
    )
    values (
      ${actorKey},
      ${scope},
      ${window.start.toISOString()}::timestamptz,
      1,
      ${window.expiresAt.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz
    )
    on conflict (actor_key, scope, window_start)
    do update set
      count = rate_limit_counters.count + 1,
      updated_at = excluded.updated_at
    where rate_limit_counters.count < ${policy.limit}
    returning count
  `);
  if (result.length > 0) {
    return {
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - Number(result[0]?.count ?? 1)),
      resetAt: window.expiresAt,
    };
  }
  throw new AppError(
    "RATE_LIMITED",
    `Too many requests. Try again in ${humanRetry(window.retryAfterSeconds)}.`,
    { status: 429 },
  );
}

export function enforceUserRateLimit(userId: string, scope: RateLimitScope) {
  return enforceRateLimit(rateLimitActor("user", userId), scope);
}

export function enforceAuthRateLimit(email: string, scope: RateLimitScope) {
  return enforceRateLimit(rateLimitActor("auth", email), scope);
}

function humanRetry(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
