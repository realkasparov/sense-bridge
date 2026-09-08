import { accessSync, constants, statSync } from "node:fs";


/**
 * What the extension is told about one provider found on this machine.
 *
 * `version` and `models` start empty and are filled in by a probe that runs in
 * the background: `claude --version` alone takes over three seconds, and the
 * settings page must not wait on it to list what is installed.
 */
export interface ProviderDescriptor {
  id: string;
  /** Absolute path to the CLI, or null when it is not installed. */
  detect(): string | null;
  /** Version and model list. Costs a subprocess, so it is never on a hot path. */
  probe?(path: string): Promise<{ version: string | null; models: string[] }>;
}

export interface ProviderInfo {
  id: string;
  path: string;
  version: string | null;
  models: string[];
}

/**
 * The first candidate that is a file this process can actually execute.
 *
 * Being named on PATH is not evidence a program is there. A half-removed
 * Homebrew cask leaves a symlink pointing at a directory it already deleted:
 * `command -v` answers with the path, every "is it installed" check that only
 * looks at the name passes, and the exec fails with ENOENT at the worst possible
 * moment. statSync follows the link, so a dangling one throws here instead.
 */
export function firstUsable(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* absent, dangling, a directory, or not ours to run */ }
  }
  return null;
}

/** Every provider present on this machine, in the order the descriptors are listed. */
export function detectProviders(providers: readonly ProviderDescriptor[]): ProviderInfo[] {
  const found: ProviderInfo[] = [];
  for (const provider of providers) {
    const path = provider.detect();
    if (path !== null) found.push({ id: provider.id, path, version: null, models: [] });
  }
  return found;
}

/**
 * Fills in what detection deliberately left out.
 *
 * Every probe runs at once and none of them can hold the rest up: `claude
 * --version` alone takes over three seconds, and doing that synchronously would
 * stop the connector answering for as long as it took — at boot, which is
 * exactly when the first request arrives.
 */
export async function probeProviders(
  providers: readonly ProviderDescriptor[], found: readonly ProviderInfo[],
): Promise<ProviderInfo[]> {
  const byId = new Map(providers.map(p => [p.id, p]));
  return Promise.all(found.map(async info => {
    const probe = byId.get(info.id)?.probe;
    if (!probe) return info;
    try {
      return { ...info, ...await probe(info.path) };
    } catch {
      // A provider that answers nothing about itself is still installed, and
      // saying so is more useful than dropping it for failing an interview.
      return info;
    }
  }));
}
