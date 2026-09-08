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
  it("is the id the published extension is signed with", () => {
    // The extension declares the same literal in its own repository and asserts
    // it there. A mismatch registers the connector for an extension that does
    // not exist, and the port dies on connect; since the two halves no longer
    // share a checkout, each side can only guard its own copy.
    expect(EXTENSION_ID).toBe("iclikaioedganbbkoepocenoneobkofb");
  });

  it("is a well-formed Chrome extension id", () => {
    // 32 characters, a-p: Chrome's base-16 alphabet shifted into letters.
    expect(EXTENSION_ID).toMatch(/^[a-p]{32}$/);
  });
});

describe("the published binary", () => {
  it("starts with a shebang so npm can run it", () => {
    const built = resolve(process.cwd(), "dist/cli.js");
    expect(readFileSync(built, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  });
});
