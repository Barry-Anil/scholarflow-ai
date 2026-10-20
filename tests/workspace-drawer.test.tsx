import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceDrawerManager } from "@/features/assignments/workspace-drawer";

describe("WorkspaceDrawerManager", () => {
  const dummyProps = {
    courseId: "123e4567-e89b-12d3-a456-426614174000",
    assignmentId: "123e4567-e89b-12d3-a456-426614174001",
    assignmentTitle: "Natural Language Processing Assignment 1",
    briefMarkdown: "Question 1. Part-of-Speech Analysis (5 marks)\n- Use the full PAWS dataset",
    questions: [
      { id: "q1", prompt: "Part-of-Speech Analysis", wordLimit: 500, position: 1 },
    ],
    criteria: [
      { id: "c1", title: "Global code quality", description: "2.5 marks: runnable code", weight: 7.14, position: 1 },
      { id: "c2", title: "Task 1 PoS analysis", description: "5 marks: correct NOUN/VERB/ADJ", weight: 14.29, position: 2 },
    ],
    answers: [{ questionId: "q1", markdown: "Completed analysis output" }],
    hasDraft: true,
    draftVersion: 1,
    events: [
      {
        id: "ev1",
        eventType: "research.completed",
        message: "Agent C completed research with 25 traceable sources.",
        createdAt: new Date().toISOString(),
      },
    ],
  };

  it("renders the 3 top quick access buttons", () => {
    render(<WorkspaceDrawerManager {...dummyProps} />);

    expect(screen.getByRole("button", { name: /Marking rubric/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent activity/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Original brief/i })).toBeInTheDocument();
  });

  it("opens the drawer on click and displays rubric scale progress", () => {
    render(<WorkspaceDrawerManager {...dummyProps} />);

    // Click Marking rubric button in the top bar
    const rubricButtons = screen.getAllByRole("button", { name: /Marking rubric/i });
    fireEvent.click(rubricButtons[0]);

    // Drawer should open and display the title and description
    expect(screen.getByRole("dialog", { name: "Marking rubric" })).toBeInTheDocument();
    expect(
      screen.getByText("Keep each answer aligned with how it will be assessed."),
    ).toBeInTheDocument();

    // Scale progress meter elements should be visible
    expect(screen.getByText(/Rubric Alignment Scale/i)).toBeInTheDocument();
    expect(screen.getByText("Global code quality")).toBeInTheDocument();
    expect(screen.getByText("Task 1 PoS analysis")).toBeInTheDocument();
  });

  it("allows switching tabs between activity and brief inside the drawer", () => {
    render(<WorkspaceDrawerManager {...dummyProps} />);

    // Click Agent activity button in the top bar
    const activityButtons = screen.getAllByRole("button", { name: /Agent activity/i });
    fireEvent.click(activityButtons[0]);

    const dialog = screen.getByRole("dialog", { name: "Agent activity" });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByText("Agent C completed research with 25 traceable sources."),
    ).toBeInTheDocument();

    // Switch to Brief tab inside the drawer header
    const briefTabButton = within(dialog).getByRole("button", { name: /Brief/i });
    fireEvent.click(briefTabButton);

    expect(screen.getByRole("dialog", { name: "Original brief" })).toBeInTheDocument();
    expect(screen.getByText(/Full brief markdown/i)).toBeInTheDocument();
  });
});
