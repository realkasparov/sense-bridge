import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";

export interface ProviderModel {
  id: string;
  /** As the CLI prints it, e.g. "2.0 GB". Null when it does not say. */
  size: string | null;
}

/**
 * What the extension is told about one provider found on this machine.
 *
 * `version` and `models` start empty and are filled in by a probe that runs in
 * the background: asking a CLI its version costs around two seconds, and the
 * settings page must not wait on that to list what is installed.
 *
 * `hint` is the difference between a dead end and a fix. A provider can be
 * installed and still unusable — a server that is not running, no model pulled —
 * and those two have opposite remedies. Reporting only "no models" would leave
 * the user with nothing to act on.
 */
export interface ProviderInfo {
  id: string;
  path: string;
  version: string | null;
  models: ProviderModel[];
  hint: string | null;
}

export interface ProviderProbe {
  version: string | null;
  models: ProviderModel[];
  hint: string | null;
}

export interface ProviderDescriptor {
  id: string;
  /** Absolute path to the CLI, or null when it is not installed. */
  detect(): string | null;
  /** Costs a subprocess, so it is never on the path of a request. */
  probe?(path: string): Promise<ProviderProbe>;
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

const shellLookups = new Map<string, string | null>();

/**
 * Where a login shell would find a command.
 *
 * A fixed list of directories cannot cover a version manager: nvm puts a global
 * npm install under ~/.nvm/versions/node/<version>/bin, and the version in that
 * path changes under the user. Chrome hands the connector a minimal PATH, so
 * asking the user's own shell is the only way to see what they see.
 *
 * Memoised: this spawns a login shell, which reads their profile, and the answer
 * cannot change while the connector is alive.
 */
export function onPath(name: string): string | null {
  if (shellLookups.has(name)) return shellLookups.get(name) ?? null;
  let found: string | null = null;
  // The names are literals in this repository, never input. Refusing anything
  // else keeps it that way rather than trusting that it stays true.
  if (/^[a-z0-9_-]+$/i.test(name)) {
    try {
      const out = spawnSync("/bin/sh", ["-lc", `command -v ${name}`],
        { encoding: "utf8", timeout: 3000 }).stdout?.trim();
      found = out ? firstUsable(out.split("\n")) : null;
    } catch { /* no shell, no profile, no answer */ }
  }
  shellLookups.set(name, found);
  return found;
}

/** The first version-shaped number in a CLI's output, which is where they all hide it. */
export function firstSemver(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

/** Every provider present on this machine, in the order the descriptors are listed. */
export function detectProviders(providers: readonly ProviderDescriptor[]): ProviderInfo[] {
  const found: ProviderInfo[] = [];
  for (const provider of providers) {
    const path = provider.detect();
    if (path !== null) {
      found.push({ id: provider.id, path, version: null, models: [], hint: null });
    }
  }
  return found;
}

/**
 * Fills in what detection deliberately left out.
 *
 * Every probe runs at once and none of them can hold the rest up, because the
 * slowest decides how long the settings page shows an incomplete list.
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
