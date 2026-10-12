import "server-only";

import { getConfigurationStatus } from "@/lib/env/server";

export function normalizeInternalPath(
  requestedPath: string | null | undefined,
  fallback = "/dashboard",
) {
  return requestedPath?.startsWith("/") && !requestedPath.startsWith("//")
    ? requestedPath
    : fallback;
}

export function getPostAuthDestination(
  requestedPath: string | null | undefined = "/dashboard",
) {
  const path = normalizeInternalPath(requestedPath);
  if (path.startsWith("/dashboard") && !getConfigurationStatus().ready) {
    return "/setup";
  }
  return path;
}
