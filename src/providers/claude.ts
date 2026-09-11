import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WorkRequest } from "../protocol.js";
import { buildContextPrompt, buildImagePrompt, buildKernelPrompt } from "../prompts.js";
export { buildContextPrompt, buildImagePrompt, buildKernelPrompt };
import type { CliOutcome, ProviderAdapter } from "./types.js";
import { firstSemver, firstUsable, onPath, type ProviderDescriptor } from "./registry.js";

// Chrome hands the connector a minimal PATH, so the CLI is found by absolute path.
const CANDIDATES = [
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  join(homedir(), ".local/bin/claude"),
  join(homedir(), ".claude/local/claude"),
];

/**
 * Homebrew marks what it installs with com.apple.quarantine. The CLI itself is
 * signed and runs fine, but it unpacks a native module to a temporary file at
 * run time, and that copy inherits the attribute while carrying no signature of
 * its own. Launched from a terminal the user has already trusted, nobody
 * notices; launched by Chrome, Gatekeeper blocks the unpacked file and shows a
 * dialog about software that "was not opened", which says nothing about this
 * extension and leaves no clue what to do.
 */
export function isQuarantined(path: string): boolean {
  const result = spawnSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", path], {
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() !== "";
}

/**
 * A CLI that is installed but not signed in fails like any other error, and the
 * message it prints says nothing about this extension. Naming the remedy is the
 * difference between a puzzle and a one-line fix.
 */
export function authFailureHint(status: number | null, output: string): string | null {
  const unauthorised = status === 401 || status === 403;
  const wording = /\b(unauthor|not logged in|log in|authenticat|credential|api key|invalid token)/i
    .test(output);
  if (!unauthorised && !wording) return null;
  return "The provider CLI is installed but not signed in. Run `claude` once in a terminal "
    + "and complete the login, then try again.";
}

export const QUARANTINE_HINT =
  "macOS has the provider CLI under quarantine, so the native module it unpacks "
  + "at run time is blocked when Chrome is the parent process. Clear it with: "
  + "xattr -d com.apple.quarantine \"$(readlink -f \"$(command -v claude)\")\"";

export const claudeAdapter: ProviderAdapter = {
  name: "claude",

  detect() {
    return firstUsable(CANDIDATES);
  },

  buildArgs(req) {
    const systemPrompt = req.type === "context" ? buildContextPrompt()
      : req.type === "image" ? buildImagePrompt()
      : buildKernelPrompt(req);
    return [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--model", req.model,
      "--effort", req.effort,
      "--max-budget-usd", String(req.budgetUsd),
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--system-prompt", systemPrompt,
    ];
  },

  buildStdin(req) {
    if (req.type === "image") {
      return JSON.stringify({
        type: "user",
        message: { role: "user", content: [
          { type: "image", source: { type: "base64", media_type: req.mediaType, data: req.dataBase64 } },
          { type: "text", text: JSON.stringify({
              targetLanguage: req.targetLanguage,
              imageWidth: req.width, imageHeight: req.height,
            }) },
        ]},
      }) + "\n";
    }
    const payload = req.type === "context"
      ? JSON.stringify({
          targetLanguage: req.targetLanguage, title: req.title, digest: req.digest,
        })
      : JSON.stringify({
          targetLanguage: req.targetLanguage, mode: req.mode, segments: req.segments,
        });
    return JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: payload }] },
    }) + "\n";
  },

  parseLine(line) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { return null; }
    if (typeof parsed !== "object" || parsed === null) return null;
    const event = parsed as Record<string, unknown>;
    if (event.type !== "result") return null;

    // subtype stays "success" on API failures - measured. Trust only these two fields.
    const apiErrorStatus = typeof event.api_error_status === "number" ? event.api_error_status : null;
    const text = typeof event.result === "string" ? event.result : null;
    return {
      ok: event.is_error !== true && text !== null,
      text,
      apiErrorStatus,
      rateLimited: apiErrorStatus === 429,
      usage: event.usage ?? null,
      costUsd: typeof event.total_cost_usd === "number" ? event.total_cost_usd : null,
    } satisfies CliOutcome;
  },
};

/**
 * The model aliases are fixed and the extension already knows them, so only the
 * version is worth asking for — and it is worth asking out of band: piped, which
 * is the only way the connector ever runs it, this takes about two seconds.
 */
export const claudeDescriptor: ProviderDescriptor = {
  id: "claude",
  detect: () => claudeAdapter.detect(),
  locate: () => onPath("claude"),
  probe: async path => {
    try {
      const { stdout } = await promisify(execFile)(path, ["--version"], { timeout: 15_000 });
      return { version: firstSemver(stdout), models: [], hint: null };
    } catch {
      return { version: null, models: [], hint: null };
    }
  },
};
