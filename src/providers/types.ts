import type { WorkRequest } from "../protocol.js";

export interface CliOutcome {
  ok: boolean;
  text: string | null;
  apiErrorStatus: number | null;
  rateLimited: boolean;
  usage: unknown | null;
}

export interface ProviderAdapter {
  name: string;
  /** Absolute path to the CLI, or null when it is not installed. */
  detect(): string | null;
  buildArgs(req: WorkRequest): string[];
  buildStdin(req: WorkRequest): string;
  /** Returns an outcome for a terminal line, or null for lines to ignore. */
  parseLine(line: string): CliOutcome | null;
}
