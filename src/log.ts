import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LOG_PATH = join(homedir(), ".sense-bridge.log");

/** stdout carries framed messages only and stderr is invisible under Chrome, so
 *  every diagnostic goes to a file. Never let logging throw. */
export function log(...parts: string[]): void {
  try { appendFileSync(LOG_PATH, `${new Date().toISOString()} ${parts.join(" ")}\n`); }
  catch { /* logging must never break the bridge */ }
}
