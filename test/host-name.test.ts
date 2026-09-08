import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The extension and the connector each hold this name, and they are separate
 * repositories now, so neither can read the other's copy. Both assert the same
 * literal instead: a change on one side fails on that side, which is the most a
 * split can preserve of what used to be one cross-check.
 */
const AGREED = "com.sense_bridge.host";

describe("native messaging host name", () => {
  it("is the name the extension connects to", () => {
    const cli = readFileSync(resolve(process.cwd(), "src/cli.ts"), "utf8");
    expect(/const HOST_NAME = "([^"]+)"/.exec(cli)?.[1]).toBe(AGREED);
  });

  it("matches the pattern Chrome accepts", () => {
    // Chrome rejects anything else outright with "Invalid native messaging host
    // name specified" — lowercase letters, digits, dots and underscores only.
    // Hyphens are not allowed, however the project is spelled elsewhere.
    expect(AGREED).toMatch(/^[a-z0-9._]+$/);
    expect(AGREED.startsWith(".")).toBe(false);
    expect(AGREED.endsWith(".")).toBe(false);
    expect(AGREED).not.toContain("..");
  });
});
