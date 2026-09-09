import { homedir } from "node:os";
import { join } from "node:path";
import {
  firstUsable, onPath,
  type ProviderDescriptor, type ProviderModel, type ProviderProbe,
} from "./registry.js";

/** Chrome hands the connector a minimal PATH, so the CLI is found by absolute path. */
const CANDIDATES = [
  "/usr/local/bin/ollama",
  "/opt/homebrew/bin/ollama",
  join(homedir(), ".local/bin/ollama"),
];

export const NOT_RUNNING_HINT =
  "Ollama is installed but not running. Start it — open the Ollama app, or run "
  + "`ollama serve` — then reopen this page.";

export const NO_MODELS_HINT =
  "Ollama is running but has no model that can translate. Pull one, for example "
  + "`ollama pull qwen2.5:7b`.";

/** Where the daemon listens. OLLAMA_HOST is how the user moves it. */
export function apiBase(host = process.env.OLLAMA_HOST): string {
  if (!host) return "http://127.0.0.1:11434";
  return /^https?:\/\//.test(host) ? host.replace(/\/$/, "") : `http://${host}`;
}

interface TagsModel {
  name?: unknown;
  details?: { parameter_size?: unknown } | null;
  capabilities?: unknown;
}

/**
 * Models out of `GET /api/tags`, keeping only those that can produce text.
 *
 * `capabilities` is the daemon's own answer, which is why it is used instead of
 * the model's name. Embedding models reply with vectors, so a page translated by
 * one fails in a way nothing downstream can tell apart from a refusal — and
 * guessing from the name misses every one that is not called "embed", such as
 * bge-m3.
 *
 * The parameter count comes along because it is the only honest signal available
 * about whether a local model can do this job at all. Someone choosing between
 * whatever they happen to have pulled should see 3.2B next to 8.2B before the
 * page comes back wrong, not after.
 */
export function parseTags(body: unknown): ProviderModel[] {
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];
  const usable: ProviderModel[] = [];
  for (const entry of models as TagsModel[]) {
    if (typeof entry?.name !== "string") continue;
    const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : [];
    // No capabilities listed at all means an older daemon that does not report
    // them; excluding those would hide every model on it.
    if (capabilities.length > 0 && !capabilities.includes("completion")) continue;
    const size = entry.details?.parameter_size;
    usable.push({ id: entry.name, size: typeof size === "string" ? size : null });
  }
  return usable.sort((a, b) => a.id.localeCompare(b.id));
}

export function detect(): string | null {
  return firstUsable(CANDIDATES);
}

export function locate(): Promise<string | null> {
  return onPath("ollama");
}

/**
 * Asks the daemon over HTTP rather than running `ollama list`.
 *
 * The CLI spends five seconds trying to start a server that is not there —
 * measured — so opening the settings page would try to launch a background
 * service on the user's machine. A refused connection answers the same question
 * immediately and starts nothing. It also carries what the CLI's table does not:
 * each model's capabilities and parameter count.
 */
export async function probe(_path: string, base = apiBase()): Promise<ProviderProbe> {
  let body: unknown;
  try {
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(String(response.status));
    body = await response.json();
  } catch {
    return { version: null, models: [], hint: NOT_RUNNING_HINT };
  }
  const models = parseTags(body);
  return {
    version: await version(base),
    models,
    hint: models.length === 0 ? NO_MODELS_HINT : null,
  };
}

async function version(base: string): Promise<string | null> {
  try {
    const response = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(3000) });
    const body = await response.json() as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

export const ollamaDescriptor: ProviderDescriptor = { id: "ollama", detect, locate, probe };
