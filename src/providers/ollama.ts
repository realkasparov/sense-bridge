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

// ── Execution ───────────────────────────────────────────────────────────

import type { WorkRequest } from "../protocol.js";
import { buildContextPrompt, buildImagePrompt, buildKernelPrompt } from "../prompts.js";
import type { RunResult } from "../runner.js";

export const OLLAMA_BASE = "http://127.0.0.1:11434";

/**
 * Local models are slow — a three-billion-parameter model took 25 seconds on
 * two short segments — and a batch is several. The ceiling is generous because
 * the alternative is a translation that was nearly finished being thrown away.
 */
export const OLLAMA_TIMEOUT_MS = 240_000;

export interface OllamaOptions {
  base?: string;
  timeoutMs?: number;
}

/**
 * Runs one request against the daemon's chat API rather than the `ollama run`
 * CLI. Two reasons, both measured. The CLI writes an ANSI spinner to stdout
 * even when piped, which makes its output a thing to be scrubbed rather than
 * parsed. And the CLI has no separate system prompt, so instructions and page
 * content would share one string — the API has real roles, and the trust
 * boundary stays structural, exactly as it is with claude.
 */
export async function runOllama(req: WorkRequest, opts: OllamaOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const base = opts.base ?? OLLAMA_BASE;
  const system = req.type === "context" ? buildContextPrompt()
    : req.type === "image" ? buildImagePrompt()
    : buildKernelPrompt(req);
  const user = userMessage(req);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? OLLAMA_TIMEOUT_MS);
  const fail = (stage: RunResult["stage"], error: string, status: number | null = null): RunResult => ({
    ok: false, stage, error, stderr: "", wallMs: Date.now() - started,
    outcome: { ok: false, text: null, apiErrorStatus: status, rateLimited: false, usage: null, costUsd: 0 },
  });

  let response: Response;
  try {
    response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: req.model,
        stream: false,
        // Grammar-constrained: the daemon will not emit anything but JSON, so
        // the "no preamble, no code fences" the prompt asks for is enforced.
        format: "json",
        messages: [{ role: "system", content: system }, user],
      }),
    });
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) return fail("timeout", `no answer from ollama within ${opts.timeoutMs ?? OLLAMA_TIMEOUT_MS}ms`);
    return fail("spawn", `could not reach ollama at ${base}: ${(error as Error).message}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = await response.json() as Record<string, unknown>;
  } catch {
    clearTimeout(timer);
    return fail("closed", `ollama answered ${response.status} with no readable body`, response.status);
  }
  clearTimeout(timer);

  if (!response.ok) {
    const detail = typeof parsed.error === "string" ? parsed.error : `HTTP ${response.status}`;
    return fail("result", `ollama: ${detail}`, response.status);
  }

  const message = parsed.message as { content?: unknown } | undefined;
  const text = typeof message?.content === "string" ? message.content : null;
  return {
    ok: text !== null, stage: "result", error: text === null ? "ollama answer had no message content" : null,
    stderr: "", wallMs: Date.now() - started,
    outcome: {
      ok: text !== null, text, apiErrorStatus: null, rateLimited: false,
      usage: {
        input_tokens: typeof parsed.prompt_eval_count === "number" ? parsed.prompt_eval_count : 0,
        output_tokens: typeof parsed.eval_count === "number" ? parsed.eval_count : 0,
      },
      // Inference on the user's own hardware has no bill. Zero is a statement,
      // not an omission: the usage page would otherwise show an estimate.
      costUsd: 0,
    },
  };
}

function userMessage(req: WorkRequest): { role: "user"; content: string; images?: string[] } {
  if (req.type === "image") {
    return {
      role: "user", images: [req.dataBase64],
      content: JSON.stringify({ targetLanguage: req.targetLanguage, imageWidth: req.width, imageHeight: req.height }),
    };
  }
  if (req.type === "context") {
    return { role: "user", content: JSON.stringify({ targetLanguage: req.targetLanguage, title: req.title, digest: req.digest }) };
  }
  return { role: "user", content: JSON.stringify({ targetLanguage: req.targetLanguage, mode: req.mode, segments: req.segments }) };
}
