import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { runOnce } from "../src/runner.js";
import { claudeAdapter } from "../src/providers/claude.js";
import type { TranslateRequest } from "../src/protocol.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

const req: TranslateRequest = {
  type: "translate", id: 1, targetLanguage: "ru", mode: "full", model: "sonnet",
  effort: "low", budgetUsd: 1, styleRules: "rules", glossary: {},
  segments: [{ id: "s1", text: "Hello" }],
};

const run = (mode: string, timeoutMs = 5000) => {
  process.env.FAKE_MODE = mode;
  return runOnce({ cliPath: FAKE, adapter: claudeAdapter, req, cwd: tmpdir(), timeoutMs,
                   spawnArgsOverride: [] });
};

describe("runOnce", () => {
  it("returns the parsed result", async () => {
    const r = await run("ok");
    expect(r.ok).toBe(true);
    expect(r.stage).toBe("result");
    expect(r.outcome?.text).toBe('{"segments":[{"id":"s1","text":"привет"}]}');
  });

  it("skips non-JSON and non-result lines", async () => {
    const r = await run("garbage");
    expect(r.ok).toBe(true);
    expect(r.outcome?.text).toContain("ок");
  });

  it("surfaces rate limiting", async () => {
    const r = await run("rate-limited");
    expect(r.ok).toBe(false);
    expect(r.outcome?.rateLimited).toBe(true);
  });

  it("times out instead of hanging forever", async () => {
    const r = await run("hang", 700);
    expect(r.stage).toBe("timeout");
    expect(r.ok).toBe(false);
  });

  it("reports a CLI that exits without a result", async () => {
    const r = await run("silent-exit");
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("closed");
  });

  it("reports a missing binary rather than throwing", async () => {
    process.env.FAKE_MODE = "ok";
    const r = await runOnce({ cliPath: "/nonexistent/cli", adapter: claudeAdapter, req,
                              cwd: tmpdir(), timeoutMs: 3000, spawnArgsOverride: [] });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("spawn");
  });
});
