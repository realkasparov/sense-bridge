import { describe, it, expect } from "vitest";
import { parseRequest, chunkResponse } from "../src/protocol.js";
import { MessageDecoder } from "../src/framing.js";

const valid = {
  type: "translate", id: 7, targetLanguage: "ru", mode: "full", model: "sonnet",
  effort: "low", budgetUsd: 1, styleRules: "Translate faithfully.", glossary: {},
  segments: [{ id: "s1", text: "Hello" }],
};

describe("parseRequest", () => {
  it("accepts a well-formed translate request", () => {
    const r = parseRequest(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("translate");
  });

  it("accepts a diag request", () => {
    expect(parseRequest({ type: "diag", id: 1 }).ok).toBe(true);
  });

  it("rejects an unknown message type", () => {
    const r = parseRequest({ type: "launchMissiles", id: 1 });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("launchMissiles") });
  });

  it("rejects an invalid effort level", () => {
    expect(parseRequest({ ...valid, effort: "turbo" }).ok).toBe(false);
  });

  it("rejects empty segments", () => {
    expect(parseRequest({ ...valid, segments: [] }).ok).toBe(false);
  });

  it("rejects duplicate segment ids", () => {
    const dup = { ...valid, segments: [{ id: "s1", text: "a" }, { id: "s1", text: "b" }] };
    expect(parseRequest(dup).ok).toBe(false);
  });

  it("rejects a segment whose text is not a string", () => {
    expect(parseRequest({ ...valid, segments: [{ id: "s1", text: 42 }] }).ok).toBe(false);
  });
});

describe("chunkResponse", () => {
  it("emits a single frame for a small payload", () => {
    expect(chunkResponse(1, { ok: true }).length).toBe(1);
  });

  it("splits a payload above the cap and reassembles in order", () => {
    const big = { ok: true, result: "x".repeat(5000) };
    const frames = chunkResponse(1, big, 1000);
    expect(frames.length).toBeGreaterThan(1);

    const d = new MessageDecoder();
    const parts = frames.flatMap(f => d.push(f)) as Array<{
      id: number; chunkIndex: number; chunkCount: number; body: string;
    }>;
    expect(parts.length).toBe(frames.length);
    parts.forEach((p, i) => {
      expect(p.id).toBe(1);
      expect(p.chunkIndex).toBe(i);
      expect(p.chunkCount).toBe(frames.length);
    });
    expect(JSON.parse(parts.map(p => p.body).join(""))).toEqual(big);
  });

  it("keeps every frame under the cap", () => {
    for (const f of chunkResponse(1, { blob: "y".repeat(50_000) }, 4096)) {
      expect(f.length).toBeLessThanOrEqual(4096);
    }
  });
});
