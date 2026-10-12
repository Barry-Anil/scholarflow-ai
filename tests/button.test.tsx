import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("retains native button semantics and focus styling", () => {
    render(<Button type="submit">Create course</Button>);
    const button = screen.getByRole("button", { name: "Create course" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass("rounded-xl", "focus-visible:ring-2");
  });

  it("supports links through the asChild pattern", () => {
    render(
      <Button asChild>
        <a href="/signup">Start</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });
});
