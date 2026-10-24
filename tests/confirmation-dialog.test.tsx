import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

function DialogHarness({ onConfirm }: { onConfirm: () => void }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      title="Delete study session?"
      description="The session and its notes will be permanently deleted."
      confirmLabel="Delete session"
      onCancel={() => setIsOpen(false)}
      onConfirm={onConfirm}
    />
  );
}

describe("ConfirmationDialog", () => {
  it("shows a focused safe action and confirms explicitly", () => {
    const onConfirm = vi.fn();
    render(<DialogHarness onConfirm={onConfirm} />);

    expect(
      screen.getByRole("dialog", { name: "Delete study session?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("dismisses on Escape without confirming", () => {
    const onConfirm = vi.fn();
    render(<DialogHarness onConfirm={onConfirm} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
