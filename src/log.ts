import { appendFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LOG_PATH = join(homedir(), ".sense-bridge.log");
const PREVIOUS_PATH = `${LOG_PATH}.1`;

/** Past this the file is rolled over, so it cannot grow without limit. */
export const MAX_LOG_BYTES = 512 * 1024;

function rollIfLarge(): void {
  try {
    if (statSync(LOG_PATH).size < MAX_LOG_BYTES) return;
    // One generation is kept: enough to read what led up to a problem, and
    // bounded at twice the ceiling rather than growing for the life of the install.
    renameSync(LOG_PATH, PREVIOUS_PATH);
  } catch { /* no file yet, or nothing that logging should care about */ }
}

/** stdout carries framed messages only and stderr is invisible under Chrome, so
 *  every diagnostic goes to a file. Never let logging throw. */
export function log(...parts: string[]): void {
  try {
    rollIfLarge();
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${parts.join(" ")}\n`);
  } catch { /* logging must never break the bridge */ }
}
