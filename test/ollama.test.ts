import { describe, it, expect } from "vitest";
import { parseModelList, parseVersion } from "../src/providers/ollama.js";

describe("parseModelList", () => {
  it("reads the names out of a real listing", () => {
    const output = [
      "NAME                                    ID              SIZE      MODIFIED",
      "qwen3-embedding:0.6b                    ac6da0dfba84    639 MB    3 days ago",
      "ilsp/llama-krikri-8b-instruct:latest    103bfffe976d    5.9 GB    10 months ago",
      "llama3.2:latest                         a80c4f17acd5    2.0 GB    19 months ago",
      "",
    ].join("\n");
    expect(parseModelList(output)).toEqual([
      "ilsp/llama-krikri-8b-instruct:latest", "llama3.2:latest",
    ]);
  });

  it("drops embedding models, which cannot translate anything", () => {
    // Offering one would produce a confident-looking failure on every page: it
    // answers with vectors, and nothing downstream can tell that from a refusal.
    expect(parseModelList("NAME  ID\nqwen3-embedding:0.6b  ac6\nllama3.2:latest  a80\n"))
      .toEqual(["llama3.2:latest"]);
  });

  it("returns nothing when no model has been pulled", () => {
    expect(parseModelList("NAME    ID    SIZE    MODIFIED\n")).toEqual([]);
  });

  it("returns nothing when the server is down", () => {
    // `ollama list` fails rather than printing a table; an installed binary with
    // no server behind it must not look like a working provider.
    expect(parseModelList("Error: could not connect to ollama app\n")).toEqual([]);
  });
});

describe("parseVersion", () => {
  it("reads the number out of the sentence it is wrapped in", () => {
    expect(parseVersion("ollama version is 0.30.10\n")).toBe("0.30.10");
  });

  it("gives up rather than guessing", () => {
    expect(parseVersion("warning: could not connect\n")).toBeNull();
  });
});
