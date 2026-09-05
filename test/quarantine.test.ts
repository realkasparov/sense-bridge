import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isQuarantined, QUARANTINE_HINT } from "../src/providers/claude.js";

const dir = mkdtempSync(join(tmpdir(), "sb-quarantine-"));

describe("isQuarantined", () => {
  it("reports a file with no quarantine attribute as clean", () => {
    const clean = join(dir, "clean.txt");
    writeFileSync(clean, "x");
    expect(isQuarantined(clean)).toBe(false);
  });

  it("recognises the attribute macOS actually sets", () => {
    const marked = join(dir, "marked.txt");
    writeFileSync(marked, "x");
    execFileSync("/usr/bin/xattr", ["-w", "com.apple.quarantine", "0081;0;Test;", marked]);
    expect(isQuarantined(marked)).toBe(true);
  });

  it("says nothing about a file that does not exist", () => {
    expect(isQuarantined(join(dir, "absent"))).toBe(false);
  });
});

describe("the hint", () => {
  it("names the command that clears it", () => {
    expect(QUARANTINE_HINT).toContain("xattr -d com.apple.quarantine");
  });
});
