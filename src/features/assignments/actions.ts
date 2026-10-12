"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import {
  requireAssignmentAccess,
  requireCourseAccess,
} from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  agentRuns,
  assignmentDrafts,
  assignmentQuestions,
  assignments,
  draftAnswers,
  rubricCriteria,
} from "@/lib/db/schema";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import {
  countWords,
  parseAssignmentQuestions,
  parseRubricCriteria,
} from "./parser";

const idSchema = z.uuid();
const createAssignmentSchema = z.object({
  title: z.string().trim().min(3, "Enter an assignment title.").max(280),
  brief: z
    .string()
    .trim()
    .min(20, "Paste at least 20 characters from the assignment brief.")
    .max(100_000),
  rubric: z.string().trim().max(50_000),
  dueAt: z.string().trim().max(40),
});

export type AssignmentActionState = {
  status: "idle" | "error" | "success";
  message?: string;
};

export async function createAssignmentAction(
  courseId: string,
  _state: AssignmentActionState,
  formData: FormData,
): Promise<AssignmentActionState> {
  const user = await requireUser();
  if (!idSchema.safeParse(courseId).success) {
    return { status: "error", message: "This course is not valid." };
  }
  const parsed = createAssignmentSchema.safeParse({
    title: formData.get("title"),
    brief: formData.get("brief"),
    rubric: formData.get("rubric") ?? "",
    dueAt: formData.get("dueAt") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "Check the assignment details.",
    };
  }

  const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return { status: "error", message: "Enter a valid due date." };
  }

  let assignmentId: string;
  try {
    await enforceUserRateLimit(user.id, "assignment.create");
    const db = getDatabase();
    await requireCourseAccess(courseId, user.id, "edit");

    const questions = parseAssignmentQuestions(parsed.data.brief);
    const criteria = parseRubricCriteria(parsed.data.rubric);
    assignmentId = await db.transaction(async (tx) => {
      const [assignment] = await tx
        .insert(assignments)
        .values({
          courseId,
          ownerId: user.id,
          title: parsed.data.title,
          briefMarkdown: parsed.data.brief,
          dueAt,
          externalResearchAllowed:
            formData.get("externalResearchAllowed") === "on",
        })
        .returning({ id: assignments.id });
      if (!assignment) {
        throw new AppError(
          "UNEXPECTED_ERROR",
          "The assignment could not be created.",
        );
      }
      await tx.insert(assignmentQuestions).values(
        questions.map((question, position) => ({
          assignmentId: assignment.id,
          position,
          prompt: question.prompt,
          requirements: question.requirements,
          wordLimit: question.wordLimit,
        })),
      );
      if (criteria.length) {
        await tx.insert(rubricCriteria).values(
          criteria.map((criterion, position) => ({
            assignmentId: assignment.id,
            position,
            title: criterion.title.slice(0, 240),
            description: criterion.description,
            weight: criterion.weight,
          })),
        );
      }
      return assignment.id;
    });
    logger.info("assignment.created", { userId: user.id, assignmentId });
  } catch (error) {
    logger.error("assignment.create_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    return { status: "error", message: safeErrorMessage(error) };
  }

  revalidatePath(`/dashboard/courses/${courseId}/assignments`);
  redirect(`/dashboard/courses/${courseId}/assignments/${assignmentId}`);
}

export async function saveDraftAction(
  assignmentId: string,
  _state: AssignmentActionState,
  formData: FormData,
): Promise<AssignmentActionState> {
  const user = await requireUser();
  if (!idSchema.safeParse(assignmentId).success) {
    return { status: "error", message: "This assignment is not valid." };
  }

  let saved:
    { courseId: string; version: number; wordCount: number } | undefined;
  try {
    await enforceUserRateLimit(user.id, "assignment.save");
    const assignment = await requireAssignmentAccess(
      assignmentId,
      user.id,
      "edit",
    );
    const db = getDatabase();
    const [activeDraftRun] = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.assignmentId, assignmentId),
          inArray(agentRuns.agent, ["student", "reviewer"]),
          inArray(agentRuns.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (activeDraftRun) {
      throw new AppError(
        "INVALID_INPUT",
        "Wait for Agent A or Agent B to finish before saving a manual version.",
        { status: 409 },
      );
    }
    const questions = await db
      .select({
        id: assignmentQuestions.id,
        position: assignmentQuestions.position,
        prompt: assignmentQuestions.prompt,
      })
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignmentId))
      .orderBy(assignmentQuestions.position);
    const answers = questions.map((question) => ({
      ...question,
      markdown: String(formData.get(`answer-${question.id}`) ?? "").trim(),
    }));
    const markdown = answers
      .map(
        (answer, index) =>
          `## Question ${index + 1}\n\n${answer.prompt}\n\n${answer.markdown}`,
      )
      .join("\n\n");
    const wordCount = countWords(
      answers.map((answer) => answer.markdown).join(" "),
    );

    const version = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${assignmentId}))`,
      );
      const [active] = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.assignmentId, assignmentId),
            inArray(agentRuns.agent, ["student", "reviewer"]),
            inArray(agentRuns.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      if (active) {
        throw new AppError(
          "INVALID_INPUT",
          "Wait for Agent A or Agent B to finish before saving a manual version.",
          { status: 409 },
        );
      }
      const [latest] = await tx
        .select({ version: assignmentDrafts.version })
        .from(assignmentDrafts)
        .where(eq(assignmentDrafts.assignmentId, assignmentId))
        .orderBy(desc(assignmentDrafts.version))
        .limit(1);
      const nextVersion = (latest?.version ?? 0) + 1;
      const [draft] = await tx
        .insert(assignmentDrafts)
        .values({
          assignmentId,
          ownerId: user.id,
          version: nextVersion,
          markdown: `# ${assignment.title}\n\n${markdown}`,
          wordCount,
        })
        .returning({ id: assignmentDrafts.id });
      if (!draft) {
        throw new AppError("UNEXPECTED_ERROR", "The draft could not be saved.");
      }
      if (answers.length) {
        await tx.insert(draftAnswers).values(
          answers.map((answer) => ({
            draftId: draft.id,
            questionId: answer.id,
            markdown: answer.markdown,
            wordCount: countWords(answer.markdown),
            confidenceScore: 0,
            confidenceReasons: [
              "Student-authored draft has not been evaluated.",
            ],
          })),
        );
      }
      await tx
        .update(assignments)
        .set({ status: "READY", approvedAt: null })
        .where(eq(assignments.id, assignmentId));
      return nextVersion;
    });

    logger.info("assignment.draft_saved", {
      userId: user.id,
      assignmentId,
      version,
    });
    saved = { courseId: assignment.courseId, version, wordCount };
  } catch (error) {
    logger.error("assignment.draft_save_failed", {
      userId: user.id,
      assignmentId,
      ...errorFingerprint(error),
    });
    return { status: "error", message: safeErrorMessage(error) };
  }

  const workspacePath = `/dashboard/courses/${saved.courseId}/assignments/${assignmentId}`;
  revalidatePath(workspacePath);
  redirect(`${workspacePath}?saved=${saved.version}&words=${saved.wordCount}`);
}
