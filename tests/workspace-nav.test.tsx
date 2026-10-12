import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceNav,
  workspaceNavigation,
} from "@/components/workspace/workspace-nav";

let pathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

describe("WorkspaceNav", () => {
  afterEach(cleanup);

  beforeEach(() => {
    pathname = "/dashboard";
  });

  it("renders every workspace destination as a real link", () => {
    render(<WorkspaceNav />);

    for (const item of workspaceNavigation) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.href,
      );
    }
  });

  it("marks only the current top-level destination as active", () => {
    pathname = "/dashboard/reviews";
    render(<WorkspaceNav />);

    expect(screen.getByRole("link", { name: "Review center" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps Courses active on course detail routes", () => {
    pathname =
      "/dashboard/courses/0f3f45ea-c844-4314-b62f-bad10949db5e/assignments";
    render(<WorkspaceNav />);

    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
