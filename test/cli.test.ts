import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableNodePath, EXTENSION_ID } from "../src/cli.js";

describe("stableNodePath", () => {
  it("prefers the name on PATH when it is the same binary", () => {
    // Package managers keep the real binary under a version directory, and that
    // path disappears at the next upgrade.
    const versioned = "/opt/homebrew/Cellar/node/24.6.0/bin/node";
    const stable = "/opt/homebrew/bin/node";
    expect(stableNodePath(versioned, () => stable)).toBe(stable);
  });

  it("keeps the resolved path when PATH points at a different node", () => {
    expect(stableNodePath("/opt/homebrew/Cellar/node/24.6.0/bin/node", () => "/usr/bin/false"))
      .toBe("/opt/homebrew/Cellar/node/24.6.0/bin/node");
  });

  it("keeps the resolved path when nothing is on PATH", () => {
    expect(stableNodePath("/some/node", () => undefined)).toBe("/some/node");
  });
});

describe("the compiled extension id", () => {
  it("matches the one the extension declares", () => {
    // Two copies of an id that must agree; a mismatch registers the host for an
    // extension that does not exist.
    const declared = readFileSync(
      resolve(process.cwd(), "extension/src/extension-id.ts"), "utf8");
    expect(declared).toContain(EXTENSION_ID);
  });
});

describe("the published binary", () => {
  it("starts with a shebang so npm can run it", () => {
    const built = resolve(process.cwd(), "dist/host/cli.js");
    expect(readFileSync(built, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  });
});
