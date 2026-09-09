import { describe, it, expect } from "vitest";
import {
  apiBase, parseTags, probe, NOT_RUNNING_HINT, NO_MODELS_HINT,
} from "../src/providers/ollama.js";
import { firstSemver } from "../src/providers/registry.js";

/** Trimmed from a real GET /api/tags on a machine with these three pulled. */
const TAGS = {
  models: [
    { name: "qwen3-embedding:0.6b",
      details: { parameter_size: "595.78M" }, capabilities: ["embedding"] },
    { name: "ilsp/llama-krikri-8b-instruct:latest",
      details: { parameter_size: "8.2B" }, capabilities: ["completion", "tools"] },
    { name: "llama3.2:latest",
      details: { parameter_size: "3.2B" }, capabilities: ["completion", "tools"] },
  ],
};

describe("parseTags", () => {
  it("keeps the models that can produce text", () => {
    expect(parseTags(TAGS)).toEqual([
      { id: "ilsp/llama-krikri-8b-instruct:latest", size: "8.2B" },
      { id: "llama3.2:latest", size: "3.2B" },
    ]);
  });

  it("drops embedding models on the daemon's own word, not on their name", () => {
    // Guessing from the name misses every embedding model that is not called
    // "embed" — bge-m3, for one — and those answer with vectors, which fails in
    // a way nothing downstream can tell apart from a refusal.
    const bge = { models: [{ name: "bge-m3:latest", details: {}, capabilities: ["embedding"] }] };
    expect(parseTags(bge)).toEqual([]);
  });

  it("keeps models from a daemon too old to report capabilities", () => {
    // Excluding anything unlabelled would empty the list on those machines.
    const old = { models: [{ name: "llama3:latest", details: { parameter_size: "8B" } }] };
    expect(parseTags(old)).toEqual([{ id: "llama3:latest", size: "8B" }]);
  });

  it("carries the parameter count, which is the signal that matters", () => {
    expect(parseTags(TAGS).map(m => m.size)).toEqual(["8.2B", "3.2B"]);
  });

  it("survives a model with no details", () => {
    expect(parseTags({ models: [{ name: "x:latest" }] })).toEqual([{ id: "x:latest", size: null }]);
  });

  it("returns nothing for a body that is not a listing", () => {
    for (const body of [null, {}, { models: "nope" }, "text"]) {
      expect(parseTags(body)).toEqual([]);
    }
  });
});

describe("apiBase", () => {
  it("defaults to the loopback address the daemon listens on", () => {
    expect(apiBase(undefined)).toBe("http://127.0.0.1:11434");
  });

  it("accepts the host:port form OLLAMA_HOST usually takes", () => {
    expect(apiBase("127.0.0.1:1234")).toBe("http://127.0.0.1:1234");
  });

  it("leaves a full URL alone, minus a trailing slash", () => {
    expect(apiBase("https://ollama.example.com/")).toBe("https://ollama.example.com");
  });
});

describe("probe", () => {
  it("says the server is not running when nothing answers", async () => {
    // Port 1 refuses immediately. The CLI would instead spend five seconds
    // trying to start a server, which is why this asks over HTTP.
    const stopped = await probe("/usr/local/bin/ollama", "http://127.0.0.1:1");
    expect(stopped.models).toEqual([]);
    expect(stopped.hint).toBe(NOT_RUNNING_HINT);
  });

  it("answers quickly rather than waiting on a daemon that is not there", async () => {
    const started = Date.now();
    await probe("/usr/local/bin/ollama", "http://127.0.0.1:1");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("tells a running server with nothing in it apart from a stopped one", async () => {
    // Opposite remedies: pull a model, or start the daemon. One hint for both
    // would leave the user with nothing to act on.
    expect(NO_MODELS_HINT).not.toBe(NOT_RUNNING_HINT);
  });
});

describe("firstSemver", () => {
  it("reads a version out of the sentence it is wrapped in", () => {
    expect(firstSemver("ollama version is 0.30.10\n")).toBe("0.30.10");
  });

  it("gives up rather than guessing", () => {
    expect(firstSemver("could not connect\n")).toBeNull();
  });
});
