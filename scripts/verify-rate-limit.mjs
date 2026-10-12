import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(sql);
const actorKey = `verification:${randomUUID()}`;
const scope = "verification";
const now = new Date();
const expiresAt = new Date(now.getTime() + 60_000);

try {
  const counts = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await db.execute(drizzleSql`
      with cleanup as (
        delete from rate_limit_counters
        where actor_key = ${actorKey}
          and expires_at <= ${now.toISOString()}::timestamptz
      )
      insert into rate_limit_counters (
        actor_key, scope, window_start, count, expires_at, updated_at
      )
      values (
        ${actorKey},
        ${scope},
        ${now.toISOString()}::timestamptz,
        1,
        ${expiresAt.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz
      )
      on conflict (actor_key, scope, window_start)
      do update set
        count = rate_limit_counters.count + 1,
        updated_at = excluded.updated_at
      where rate_limit_counters.count < 2
      returning count
    `);
    counts.push(rows[0]?.count ?? null);
  }
  if (JSON.stringify(counts) !== JSON.stringify([1, 2, null]))
    throw new Error("Atomic counter verification failed.");
  console.log("Rate-limit counter verified.");
} finally {
  await sql`delete from rate_limit_counters where actor_key = ${actorKey}`;
  await sql.end();
}
