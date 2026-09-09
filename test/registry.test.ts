import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProviders, firstUsable, onPath, probeProviders } from "../src/providers/registry.js";
import type { ProviderDescriptor } from "../src/providers/registry.js";

let dir: string;
let real: string;
let dangling: string;
let notExecutable: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sb-registry-"));
  real = join(dir, "real-cli");
  writeFileSync(real, "#!/bin/sh\necho hi\n");
  chmodSync(real, 0o755);

  // Exactly the state a half-removed Homebrew cask leaves behind: the name is on
  // PATH, `command -v` answers with it, and exec fails with ENOENT.
  dangling = join(dir, "dangling-cli");
  symlinkSync(join(dir, "gone"), dangling);

  notExecutable = join(dir, "data-file");
  writeFileSync(notExecutable, "not a program\n");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const stub = (id: string, path: string | null): ProviderDescriptor => ({
  id, detect: () => path,
});

describe("firstUsable", () => {
  it("finds a candidate that exists and can be run", () => {
    expect(firstUsable([real])).toBe(real);
  });

  it("refuses a symlink whose target is gone", () => {
    // The whole point: a name being on PATH is not evidence a program is there.
    expect(firstUsable([dangling])).toBeNull();
  });

  it("refuses a file that is not executable", () => {
    expect(firstUsable([notExecutable])).toBeNull();
  });

  it("takes the first usable candidate, not the first named one", () => {
    expect(firstUsable([dangling, notExecutable, real])).toBe(real);
  });

  it("returns null when nothing is there", () => {
    expect(firstUsable([join(dir, "absent")])).toBeNull();
  });
});

describe("detectProviders", () => {
  it("reports nothing when no adapter finds a CLI", () => {
    expect(detectProviders([stub("claude", null), stub("ollama", null)])).toEqual([]);
  });

  it("reports every adapter that found one", () => {
    const found = detectProviders([stub("claude", real), stub("ollama", null), stub("codex", real)]);
    expect(found.map(p => p.id)).toEqual(["claude", "codex"]);
    expect(found[0]).toMatchObject({ id: "claude", path: real });
  });

  it("reports a provider before anything is known about it", () => {
    // Probing costs seconds — `claude --version` alone takes over three. The
    // settings page must be able to list a provider without waiting for that.
    const [only] = detectProviders([stub("claude", real)]);
    expect(only).toMatchObject({ version: null, models: [], hint: null });
  });
});

describe("probeProviders", () => {
  it("fills in what detection left out", async () => {
    const probing: ProviderDescriptor = {
      id: "ollama", detect: () => real,
      probe: async () => ({ version: "0.30.10", models: [{ id: "llama3.2:latest", size: "2.0 GB" }], hint: null }),
    };
    const filled = await probeProviders([probing], detectProviders([probing]));
    expect(filled[0]).toMatchObject({ version: "0.30.10" });
    expect(filled[0]!.models).toEqual([{ id: "llama3.2:latest", size: "2.0 GB" }]);
  });

  it("keeps a provider whose probe throws", async () => {
    // Installed but uncommunicative is still installed. Dropping it here would
    // report "no providers found" to someone looking straight at the binary.
    const broken: ProviderDescriptor = {
      id: "claude", detect: () => real,
      probe: async () => { throw new Error("timed out"); },
    };
    const filled = await probeProviders([broken], detectProviders([broken]));
    expect(filled).toMatchObject([{ id: "claude", path: real, version: null }]);
  });

  it("finds a provider the cheap pass could not afford to look for", async () => {
    // nvm's path carries the node version in it, so no fixed list can name it.
    // The shell knows; asking costs a login shell, which is why it happens here
    // and not in detect.
    const hidden: ProviderDescriptor = {
      id: "claude", detect: () => null, locate: async () => real,
      probe: async () => ({ version: "2.1.236", models: [], hint: null }),
    };
    const filled = await probeProviders([hidden], detectProviders([hidden]));
    expect(filled).toMatchObject([{ id: "claude", path: real, version: "2.1.236" }]);
  });

  it("does not look twice for a provider the cheap pass already found", async () => {
    let located = 0;
    const both: ProviderDescriptor = {
      id: "claude", detect: () => real,
      locate: async () => { located++; return real; },
    };
    const filled = await probeProviders([both], detectProviders([both]));
    expect(located).toBe(0);
    expect(filled).toHaveLength(1);
  });

  it("leaves a provider that cannot be probed alone", async () => {
    const filled = await probeProviders([stub("claude", real)], detectProviders([stub("claude", real)]));
    expect(filled[0]).toMatchObject({ version: null, models: [] });
  });
});

describe("onPath", () => {
  it("finds a command a login shell can see", async () => {
    // A fixed list of directories cannot cover a version manager: nvm puts a
    // global npm install under a path with the node version in it, and Chrome
    // hands the connector a minimal PATH, so the user's shell is the only place
    // that knows where their own tools are.
    expect(await onPath("sh")).not.toBeNull();
  });

  it("returns null for something that is not installed", async () => {
    expect(await onPath("definitely-not-a-real-command-xyz")).toBeNull();
  });

  it("is never called from detect, so it never blocks a request", () => {
    // The point of splitting it out: everyone who has *not* installed a
    // provider would otherwise pay a login shell to find that out, on every
    // start, before the connector could answer anything.
    expect(onPath("sh")).toBeInstanceOf(Promise);
  });

  it("refuses a name that is not a plain command name", async () => {
    // The names are literals in this repository. Refusing anything else keeps a
    // shell string from ever being built out of something that is not one.
    expect(await onPath("sh; touch /tmp/sb-injected")).toBeNull();
  });
});
