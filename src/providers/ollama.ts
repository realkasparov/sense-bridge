import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  firstSemver, firstUsable, onPath,
  type ProviderDescriptor, type ProviderModel, type ProviderProbe,
} from "./registry.js";

const run = promisify(execFile);

/** Chrome hands the connector a minimal PATH, so the CLI is found by absolute path. */
const CANDIDATES = [
  "/usr/local/bin/ollama",
  "/opt/homebrew/bin/ollama",
  join(homedir(), ".local/bin/ollama"),
];

export const NOT_RUNNING_HINT =
  "Ollama is installed but not answering. Start it — open the Ollama app, or run "
  + "`ollama serve` — then reopen this page.";

export const NO_MODELS_HINT =
  "Ollama is running but has no model that can translate. Pull one, for example "
  + "`ollama pull qwen2.5:7b`.";

/**
 * Model names and sizes out of `ollama list`.
 *
 * The size comes along because it is the only honest signal available about
 * whether a local model can do this job at all. A 2 GB model translates roughly
 * the way a 2 GB model translates, and someone choosing between what they happen
 * to have pulled deserves to see the difference before the page comes back
 * wrong.
 *
 * Embedding models are dropped. They sit in the listing looking like an ordinary
 * choice and answer with vectors instead of text, so a page translated by one
 * fails in a way nothing downstream can tell apart from a refusal.
 */
export function parseModelList(output: string): ProviderModel[] {
  const models: ProviderModel[] = [];
  for (const line of output.split("\n")) {
    const [name, , amount, unit] = line.trim().split(/\s+/);
    if (!name || name === "NAME") continue;
    // A model name is `[namespace/]name:tag`, and the tag is never empty. An
    // error line ends at the colon — "Error: could not connect" would otherwise
    // be listed as a model called "Error:" and offered to the user.
    if (!/^[^\s:/]+(?:\/[^\s:/]+)*:[^\s:]+$/.test(name)) continue;
    if (/embed/i.test(name)) continue;
    const size = /^[\d.]+$/.test(amount ?? "") && /^[A-Z]B$/i.test(unit ?? "")
      ? `${amount} ${unit}` : null;
    models.push({ id: name, size });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

export function detect(): string | null {
  return firstUsable(CANDIDATES);
}

export function locate(): Promise<string | null> {
  return onPath("ollama");
}

/**
 * `ollama list` talks to the server, so its exit status is how an installed
 * binary with nothing running behind it stops looking usable. `--version`
 * answers either way, which is why the two are asked separately: the version is
 * still worth reporting for a provider that cannot currently be used.
 */
export async function probe(path: string): Promise<ProviderProbe> {
  const ask = async (args: string[]): Promise<string | null> => {
    try { return (await run(path, args, { timeout: 15_000 })).stdout; } catch { return null; }
  };
  const [version, list] = await Promise.all([ask(["--version"]), ask(["list"])]);
  const models = list === null ? [] : parseModelList(list);
  return {
    version: firstSemver(version ?? ""),
    models,
    hint: list === null ? NOT_RUNNING_HINT : models.length === 0 ? NO_MODELS_HINT : null,
  };
}

export const ollamaDescriptor: ProviderDescriptor = { id: "ollama", detect, locate, probe };
