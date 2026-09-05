import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageDecoder } from "./framing.js";
import { chunkResponse, parseRequest, type WorkRequest } from "./protocol.js";
import { claudeAdapter, isQuarantined, QUARANTINE_HINT } from "./providers/claude.js";
import { ProcessPool } from "./pool.js";
import { runOn, spawnCli, type CliProcess } from "./runner.js";
import { log, LOG_PATH } from "./log.js";

const POOL_SIZE = 2;
// An empty cwd keeps the CLI from discovering a CLAUDE.md on this machine.
const WORK_DIR = mkdtempSync(join(tmpdir(), "sense-bridge-"));

// Chrome starts a host per connection, so without this every session would leave
// a directory behind in the system temp folder for good.
const cleanUp = () => { try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch { /* going away anyway */ } };
process.on("exit", cleanUp);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => { cleanUp(); process.exit(0); });
}
const adapter = claudeAdapter;
const cliPath = process.env.SENSEBRIDGE_CLI_PATH ?? adapter.detect();
const fakeArgs = process.env.SENSEBRIDGE_FAKE_ARGS === "1";

log(`HOST boot pid=${process.pid} ppid=${process.ppid} node=${process.version} cli=${cliPath}`);

const send = (id: number, payload: unknown) => {
  for (const frame of chunkResponse(id, payload)) process.stdout.write(frame);
};

// The pool boots real CLI processes for the current settings. The key must cover
// everything baked in at spawn time, or a warm process would answer with the
// wrong model, effort or prompt.
let pendingArgs: string[] = [];
const pool = new ProcessPool<CliProcess>({
  size: POOL_SIZE,
  // Idle CLI processes are not cheap and a page is usually finished within a
  // minute; holding them for longer spends memory on nothing.
  maxAgeMs: 60_000,
  spawnFn: () => spawnCli(cliPath!, pendingArgs, WORK_DIR),
});

// Warm processes must not outlive their usefulness: Chrome keeps the host alive
// for as long as the port is open, and idle CLI processes are not cheap.
// unref so the reaper never keeps the host from exiting.
setInterval(() => pool.reap(), 30_000).unref();

const configKey = (req: WorkRequest) =>
  [req.type, req.model, req.effort, req.budgetUsd, req.targetLanguage,
   createHash("sha256").update(adapter.buildArgs(req).join("\u0000")).digest("hex").slice(0, 16)]
    .join("|");

process.on("uncaughtException", e => {
  log("UNCAUGHT", String(e instanceof Error ? e.stack : e));
  process.exit(1);
});

let inFlight = 0;
let stdinClosed = false;
const maybeExit = () => { if (stdinClosed && inFlight === 0) { pool.drain(); process.exit(0); } };

const decoder = new MessageDecoder();
process.stdin.on("data", chunk => {
  for (const raw of decoder.push(chunk)) {
    const parsed = parseRequest(raw);
    const id = (raw as { id?: number }).id ?? 0;

    if (!parsed.ok) {
      log("REJECT", parsed.error);
      send(id, { ok: false, stage: "validation", error: parsed.error });
      continue;
    }

    const req = parsed.value;
    if (req.type === "diag") {
      send(req.id, { ok: true, diag: {
        node: process.version, PATH: process.env.PATH ?? "(unset)",
        HOME: process.env.HOME ?? "(unset)", cliPath, cwd: WORK_DIR,
        poolSize: pool.size(), log: LOG_PATH,
        quarantined: cliPath ? isQuarantined(cliPath) : null,
      }});
      continue;
    }

    if (!cliPath) {
      send(req.id, { ok: false, stage: "resolve", error: "provider CLI not found",
                     hint: "Chrome gives the host a minimal PATH; an absolute path is required." });
      continue;
    }

    inFlight++;
    log(`RUN id=${req.id} type=${req.type} `
      + (req.type === "translate" ? `segments=${req.segments.length}`
        : req.type === "image" ? `bytes=${req.dataBase64.length}`
        : `digest=${req.digest.length}`));
    pendingArgs = fakeArgs ? [] : adapter.buildArgs(req);
    // The context pass runs once per page. Pooling it would spawn warm processes
    // for a configuration the next batch immediately drains.
    const proc = req.type !== "translate"
      ? spawnCli(cliPath, pendingArgs, WORK_DIR)
      : pool.acquire(configKey(req));
    void runOn(proc, adapter, req)
      .then(r => {
        // A run that failed with the CLI under quarantine almost always failed
        // for that reason, and the macOS dialog names neither this extension nor
        // a remedy.
        const quarantineHint = !r.ok && cliPath && isQuarantined(cliPath)
          ? QUARANTINE_HINT : undefined;
        send(req.id, {
          ok: r.ok, stage: r.stage, wallMs: r.wallMs, hint: quarantineHint,
          result: r.outcome?.text ?? null, usage: r.outcome?.usage ?? null,
          costUsd: r.outcome?.costUsd ?? null,
          rateLimited: r.outcome?.rateLimited ?? false,
          apiErrorStatus: r.outcome?.apiErrorStatus ?? null,
          error: r.error, stderr: r.stderr,
        });
      })
      .catch(e => {
        log("HANDLER", String(e));
        send(req.id, { ok: false, stage: "handler", error: String(e) });
      })
      .finally(() => { inFlight--; maybeExit(); });
  }
});

process.stdin.on("end", () => { stdinClosed = true; maybeExit(); });
