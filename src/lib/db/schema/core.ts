import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { timestamps } from "./common";
import { courseMemberRole } from "./enums";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: varchar("display_name", { length: 160 }),
  avatarUrl: text("avatar_url"),
  timezone: varchar("timezone", { length: 80 }).default("UTC").notNull(),
  settings: jsonb("settings")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  ...timestamps(),
});

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    code: varchar("code", { length: 48 }),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [index("courses_owner_idx").on(table.ownerId)],
);

export const courseMembers = pgTable(
  "course_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: courseMemberRole("role").default("viewer").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("course_members_course_user_uidx").on(
      table.courseId,
      table.userId,
    ),
    index("course_members_user_idx").on(table.userId),
  ],
);
