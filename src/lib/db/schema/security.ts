import {
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    actorKey: varchar("actor_key", { length: 96 }).notNull(),
    scope: varchar("scope", { length: 80 }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").default(1).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "rate_limit_counters_pk",
      columns: [table.actorKey, table.scope, table.windowStart],
    }),
    index("rate_limit_counters_expiry_idx").on(table.expiresAt),
  ],
);
