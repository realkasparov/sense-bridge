import { describe, it, expect } from "vitest";
import { parseModelList, probe, NOT_RUNNING_HINT, NO_MODELS_HINT } from "../src/providers/ollama.js";
import { firstSemver } from "../src/providers/registry.js";

const LISTING = [
  "NAME                                    ID              SIZE      MODIFIED",
  "qwen3-embedding:0.6b                    ac6da0dfba84    639 MB    3 days ago",
  "ilsp/llama-krikri-8b-instruct:latest    103bfffe976d    5.9 GB    10 months ago",
  "llama3.2:latest                         a80c4f17acd5    2.0 GB    19 months ago",
  "",
].join("\n");

describe("parseModelList", () => {
  it("reads names and sizes out of a real listing", () => {
    expect(parseModelList(LISTING)).toEqual([
      { id: "ilsp/llama-krikri-8b-instruct:latest", size: "5.9 GB" },
      { id: "llama3.2:latest", size: "2.0 GB" },
    ]);
  });

  it("keeps the size, because it is the only honest signal about a local model", () => {
    // Someone choosing between what they happen to have pulled cannot otherwise
    // tell a 2 GB model from a 40 GB one until the page comes back wrong.
    expect(parseModelList(LISTING).map(m => m.size)).toEqual(["5.9 GB", "2.0 GB"]);
  });

  it("drops embedding models, which cannot translate anything", () => {
    expect(parseModelList(LISTING).map(m => m.id)).not.toContain("qwen3-embedding:0.6b");
  });

  it("survives a listing with no size column", () => {
    expect(parseModelList("NAME  ID\nllama3.2:latest  a80\n"))
      .toEqual([{ id: "llama3.2:latest", size: null }]);
  });

  it("returns nothing when no model has been pulled", () => {
    expect(parseModelList("NAME    ID    SIZE    MODIFIED\n")).toEqual([]);
  });

  it("never mistakes an error line for a model", () => {
    expect(parseModelList("Error: could not connect to ollama app\n")).toEqual([]);
  });
});

describe("probe", () => {
  it("tells a stopped server apart from an empty one", async () => {
    // The two look identical in the model list and have opposite remedies:
    // start the server, or pull a model. Reporting only "no models" leaves the
    // user with nothing to act on.
    const stopped = await probe("/usr/bin/false");
    expect(stopped.models).toEqual([]);
    expect(stopped.hint).toBe(NOT_RUNNING_HINT);
  });

  it("says what to do when the server answers with nothing in it", async () => {
    const empty = await probe("/usr/bin/true");
    expect(empty.hint).toBe(NO_MODELS_HINT);
  });

  it("has no hint to give when there is nothing wrong", async () => {
    const real = await probe("/usr/local/bin/ollama").catch(() => null);
    if (real && real.models.length > 0) expect(real.hint).toBeNull();
  });
});

describe("firstSemver", () => {
  it("reads the number out of the sentence it is wrapped in", () => {
    expect(firstSemver("ollama version is 0.30.10\n")).toBe("0.30.10");
  });

  it("still finds it when the server is down and the wording changes", () => {
    // Measured: `ollama --version` exits 0 with "Warning: could not connect to a
    // running Ollama instance" and then "client version is 0.30.10".
    expect(firstSemver("Warning: could not connect\nWarning: client version is 0.30.10\n"))
      .toBe("0.30.10");
  });

  it("gives up rather than guessing", () => {
    expect(firstSemver("warning: could not connect\n")).toBeNull();
  });
});
