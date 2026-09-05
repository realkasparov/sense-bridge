import { describe, it, expect } from "vitest";
import { claudeAdapter, buildKernelPrompt } from "../src/providers/claude.js";
import type { TranslateRequest } from "../src/protocol.js";

const req: TranslateRequest = {
  type: "translate", id: 1, targetLanguage: "ru", mode: "full", model: "sonnet",
  effort: "low", budgetUsd: 2, styleRules: "KEEP TECHNICAL TERMS", glossary: { pipeline: "конвейер" },
  segments: [{ id: "s1", text: "Hello <0>world</0>" }],
};

describe("buildArgs", () => {
  const args = claudeAdapter.buildArgs(req);

  it("disarms the model", () => {
    for (const flag of ["--tools", "--strict-mcp-config", "--setting-sources",
                        "--no-session-persistence", "--disable-slash-commands"]) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });

  it("passes model, effort and budget through", () => {
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(args[args.indexOf("--effort") + 1]).toBe("low");
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("2");
  });

  it("never passes --bare, which would break subscription auth", () => {
    expect(args).not.toContain("--bare");
  });

  it("uses stream-json in both directions", () => {
    expect(args[args.indexOf("--input-format") + 1]).toBe("stream-json");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
  });
});

describe("buildKernelPrompt", () => {
  it("sandwiches the user's style rules between kernel sections", () => {
    const p = buildKernelPrompt(req);
    const rules = p.indexOf("KEEP TECHNICAL TERMS");
    expect(p.indexOf("TRUST BOUNDARY")).toBeLessThan(rules);
    expect(p.indexOf("the invariants win")).toBeGreaterThan(rules);
  });

  it("carries the glossary", () => {
    expect(buildKernelPrompt(req)).toContain("конвейер");
  });
});

describe("parseLine", () => {
  it("ignores non-result lines", () => {
    expect(claudeAdapter.parseLine('{"type":"assistant"}')).toBeNull();
    expect(claudeAdapter.parseLine("not json")).toBeNull();
  });

  it("reads a successful result", () => {
    const out = claudeAdapter.parseLine(JSON.stringify({
      type: "result", subtype: "success", is_error: false, api_error_status: null,
      result: '{"segments":[]}', usage: { input_tokens: 5 },
    }));
    expect(out).toMatchObject({ ok: true, text: '{"segments":[]}', rateLimited: false });
  });

  it("treats is_error as failure even when subtype says success", () => {
    const out = claudeAdapter.parseLine(JSON.stringify({
      type: "result", subtype: "success", is_error: true, api_error_status: 404,
      result: "There's an issue with the selected model",
    }));
    expect(out).toMatchObject({ ok: false, apiErrorStatus: 404, rateLimited: false });
  });

  it("flags rate limiting on 429", () => {
    const out = claudeAdapter.parseLine(JSON.stringify({
      type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "rate limited",
    }));
    expect(out).toMatchObject({ ok: false, rateLimited: true });
  });
});
