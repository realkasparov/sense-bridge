import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { WorkRequest } from "./protocol.js";
import type { CliOutcome, ProviderAdapter } from "./providers/types.js";

export interface RunResult {
  ok: boolean;
  stage: "result" | "timeout" | "spawn" | "closed";
  outcome: CliOutcome | null;
  error: string | null;
  stderr: string;
  wallMs: number;
}

export interface RunOptions {
  cliPath: string;
  adapter: ProviderAdapter;
  req: WorkRequest;
  cwd: string;
  timeoutMs?: number;
  /** Tests pass [] to run a fake CLI that takes no flags. */
  spawnArgsOverride?: string[];
}

export interface CliProcess {
  child: ChildProcessWithoutNullStreams;
  spawnedAt: number;
  isAlive(): boolean;
  kill(): void;
}

/** Boots a CLI process that sits waiting on stdin, so a pool can prepare it early. */
export function spawnCli(cliPath: string, args: string[], cwd: string): CliProcess {
  const child = spawn(cliPath, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  // Without listeners an ENOENT or EPIPE becomes an uncaught exception and takes
  // the whole host down. runOn replaces these with handlers that report.
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  return {
    child,
    spawnedAt: Date.now(),
    isAlive: () => child.exitCode === null && child.signalCode === null && !child.killed,
    kill: () => { try { child.kill(); } catch { /* gone */ } },
  };
}

export function runOnce(opts: RunOptions): Promise<RunResult> {
  const { cliPath, adapter, req, cwd, timeoutMs } = opts;
  const args = opts.spawnArgsOverride ?? adapter.buildArgs(req);
  return runOn(spawnCli(cliPath, args, cwd), adapter, req, timeoutMs);
}

/** Sends one request to an already-booted process. The process is single-use. */
export function runOn(
  proc: CliProcess,
  adapter: ProviderAdapter,
  req: WorkRequest,
  timeoutMs = 90_000,
): Promise<RunResult> {
  const t0 = Date.now();
  const child = proc.child;

  return new Promise<RunResult>(resolve => {
    let settled = false;
    let stderr = "";
    // Only the beginning is ever reported, and a chatty CLI can produce
    // megabytes: keeping the rest holds memory for something nobody reads.
    const STDERR_LIMIT = 8192;

    const finish = (r: Omit<RunResult, "wallMs" | "stderr">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill();
      resolve({ ...r, stderr: stderr.slice(0, 4000), wallMs: Date.now() - t0 });
    };

    const timer = setTimeout(
      () => finish({ ok: false, stage: "timeout", outcome: null,
                     error: `no result within ${timeoutMs}ms` }),
      timeoutMs);

    child.on("error", e => finish({ ok: false, stage: "spawn", outcome: null, error: String(e) }));
    child.stdin.on("error", e => finish({ ok: false, stage: "spawn", outcome: null, error: String(e) }));
    child.stderr.on("data", d => {
      if (stderr.length < STDERR_LIMIT) stderr += String(d).slice(0, STDERR_LIMIT - stderr.length);
    });

    // Answer on the first result line: with stream-json input the CLI stays alive
    // waiting for more input, so waiting for exit would hang forever.
    createInterface({ input: child.stdout }).on("line", line => {
      if (!line.trim()) return;
      const outcome = adapter.parseLine(line);
      if (!outcome) return;
      finish({ ok: outcome.ok, stage: "result", outcome, error: null });
    });

    child.on("close", code =>
      finish({ ok: false, stage: "closed", outcome: null,
               error: `CLI exited (code ${code}) without emitting a result` }));

    child.stdin.write(adapter.buildStdin(req));
    child.stdin.end();
  });
}
