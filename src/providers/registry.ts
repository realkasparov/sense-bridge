import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { promisify } from "node:util";

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
  /** Filesystem only. Cheap enough to run on every request, and it must stay so. */
  detect(): string | null;
  /**
   * Where the user's own shell would find it, for installs no fixed list can
   * predict. Spawns a login shell, so it runs only in the background pass.
   */
  locate?(): Promise<string | null>;
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

const shellLookups = new Map<string, Promise<string | null>>();

/**
 * Where a login shell would find a command.
 *
 * A fixed list of directories cannot cover a version manager: nvm puts a global
 * npm install under ~/.nvm/versions/node/<version>/bin, and the version in that
 * path changes under the user. Chrome hands the connector a minimal PATH, so
 * asking the user's own shell is the only way to see what they see.
 *
 * Asynchronous and memoised, and never called from `detect`. A login shell reads
 * the user's profile, which is somebody else's code of unknown length; doing
 * that synchronously would stop the connector answering, and doing it in
 * `detect` would charge everyone who has *not* installed a provider the full
 * price of finding that out, on every start.
 */
export function onPath(name: string): Promise<string | null> {
  const cached = shellLookups.get(name);
  if (cached) return cached;
  // The names are literals in this repository, never input. Refusing anything
  // else keeps it that way rather than trusting that it stays true.
  const lookup = !/^[a-z0-9_-]+$/i.test(name)
    ? Promise.resolve(null)
    : promisify(execFile)("/bin/sh", ["-lc", `command -v ${name}`], { timeout: 5000 })
        .then(({ stdout }) => firstUsable(stdout.trim().split("\n")))
        .catch(() => null);
  shellLookups.set(name, lookup);
  return lookup;
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
 * Fills in what detection deliberately left out, and finds what it could not
 * afford to look for.
 *
 * Everything here runs at once and nothing can hold the rest up, because the
 * slowest step decides how long the settings page shows an incomplete list.
 */
export async function probeProviders(
  providers: readonly ProviderDescriptor[], found: readonly ProviderInfo[],
): Promise<ProviderInfo[]> {
  const byId = new Map(providers.map(p => [p.id, p]));
  const seen = new Set(found.map(info => info.id));

  // A provider the cheap pass missed may still be installed somewhere only the
  // user's shell knows about. This is where that costs nothing anyone waits for.
  const late = await Promise.all(providers
    .filter(provider => !seen.has(provider.id) && provider.locate)
    .map(async provider => {
      const path = await provider.locate!().catch(() => null);
      return path === null ? null
        : { id: provider.id, path, version: null, models: [], hint: null } satisfies ProviderInfo;
    }));

  const all = [...found, ...late.filter(info => info !== null)];
  return Promise.all(all.map(async info => {
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
