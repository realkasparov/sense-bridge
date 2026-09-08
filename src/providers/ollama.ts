import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { firstUsable, type ProviderDescriptor } from "./registry.js";

const run = promisify(execFile);

/** Chrome hands the connector a minimal PATH, so the CLI is found by absolute path. */
const CANDIDATES = [
  "/usr/local/bin/ollama",
  "/opt/homebrew/bin/ollama",
  join(homedir(), ".local/bin/ollama"),
];

/**
 * Model names out of `ollama list`.
 *
 * Embedding models are dropped. They are listed alongside the rest and look like
 * an ordinary choice, but they answer with vectors instead of text: offering one
 * would give a failure on every page that nothing downstream could tell apart
 * from a refusal.
 */
export function parseModelList(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split("\n")) {
    const name = line.trim().split(/\s+/)[0];
    if (!name || name === "NAME") continue;
    // A model name is `[namespace/]name:tag`, and the tag is never empty. An
    // error line ends at the colon — "Error: could not connect" would otherwise
    // be listed as a model called "Error:" and offered to the user.
    if (!/^[^\s:/]+(?:\/[^\s:/]+)*:[^\s:]+$/.test(name)) continue;
    if (/embed/i.test(name)) continue;
    names.push(name);
  }
  return names.sort();
}

export function parseVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function detect(): string | null {
  return firstUsable(CANDIDATES);
}

/**
 * Costs a subprocess, so it is never on the path of a diagnostic the settings
 * page waits for. `ollama list` talks to the server, so its failure is also how
 * an installed binary with nothing running behind it stops looking available.
 */
export async function probe(path: string): Promise<{ version: string | null; models: string[] }> {
  const ask = async (args: string[]) => {
    try { return (await run(path, args, { timeout: 5000 })).stdout; } catch { return ""; }
  };
  const [version, list] = await Promise.all([ask(["--version"]), ask(["list"])]);
  return { version: parseVersion(version), models: parseModelList(list) };
}

export const ollamaDescriptor: ProviderDescriptor = { id: "ollama", detect, probe };
