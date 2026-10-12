import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "@/lib/env/server";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

export function getDatabase() {
  const { DATABASE_URL } = getServerEnv();
  client ??= postgres(DATABASE_URL, {
    max: process.env.NODE_ENV === "production" ? 10 : 1,
    prepare: false,
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof getDatabase>;
