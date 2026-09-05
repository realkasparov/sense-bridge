import { describe, it, expect } from "vitest";
import { authFailureHint } from "../src/providers/claude.js";

describe("authFailureHint", () => {
  it("recognises an unauthorised status", () => {
    expect(authFailureHint(401, "")).toContain("not signed in");
    expect(authFailureHint(403, "")).toContain("not signed in");
  });

  it("recognises the wording the CLI uses", () => {
    for (const output of [
      "Invalid API key · Please run /login",
      "You are not logged in",
      "authentication failed",
      "could not read credentials",
    ]) {
      expect(authFailureHint(null, output), output).toContain("not signed in");
    }
  });

  it("names what to actually do", () => {
    // The CLI's own message says nothing about this extension.
    expect(authFailureHint(401, "")).toContain("claude");
  });

  it("says nothing about failures that are not about signing in", () => {
    expect(authFailureHint(429, "rate limited")).toBeNull();
    expect(authFailureHint(500, "internal error")).toBeNull();
    expect(authFailureHint(null, "no result within 90000ms")).toBeNull();
  });
});
