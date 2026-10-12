import { describe, expect, it } from "vitest";

import { loginSchema, signupSchema } from "@/lib/validation/auth";

describe("authentication validation", () => {
  it("accepts a valid university-style login", () => {
    expect(
      loginSchema.safeParse({
        email: "student@example.edu",
        password: "secret",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed email addresses", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "secret",
    });
    expect(result.success).toBe(false);
  });

  it("requires matching, sufficiently strong signup passwords", () => {
    const result = signupSchema.safeParse({
      displayName: "Alex Morgan",
      email: "alex@example.edu",
      password: "short",
      confirmPassword: "different",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password).toBeDefined();
      expect(result.error.flatten().fieldErrors.confirmPassword).toBeDefined();
    }
  });
});
