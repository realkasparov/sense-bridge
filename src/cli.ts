#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeAdapter, claudeDescriptor, isQuarantined } from "./providers/claude.js";
import { ollamaDescriptor } from "./providers/ollama.js";
import { detectProviders } from "./providers/registry.js";
import { CONNECTOR_VERSION } from "./version.js";

/**
 * Registers the native messaging host with Chrome.
 *
 * The paths are worked out from this file's own location rather than from a
 * repository layout, so the same code serves a clone, an npm install and a
 * Homebrew formula — all three put the files somewhere different.
 */
const HOST_NAME = "com.sense_bridge.host";

/** Fixed by the key pinned in the extension manifest, so nobody has to look it up. */
export const EXTENSION_ID = "iclikaioedganbbkoepocenoneobkofb";

const RUN_DIR = join(homedir(), "Library", "Application Support", "SenseBridge");
const MANIFEST_DIR = join(
  homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
const MANIFEST_PATH = join(MANIFEST_DIR, `${HOST_NAME}.json`);
const LOG_PATH = join(homedir(), ".sense-bridge.log");

const distDir = dirname(fileURLToPath(import.meta.url));

/**
 * The path to record in the wrapper.
 *
 * process.execPath resolves symlinks, and package managers keep the real binary
 * under a version directory — Homebrew's is Cellar/node/24.6.0, nvm's is
 * versions/node/v24.6.0. Recording that guarantees a connector that stops working at
 * the next upgrade, so the stable name on PATH is preferred when it points at
 * this same Node.
 */
export function stableNodePath(
  execPath = process.execPath,
  lookup = () => spawnSync("/bin/sh", ["-lc", "command -v node"], {
    encoding: "utf8", timeout: 3000,
  }).stdout?.trim(),
): string {
  const onPath = lookup();
  if (!onPath) return execPath;

  // Only if it really is the same Node: a different one would be a silent swap.
  const sameBinary = spawnSync(onPath, ["-p", "process.execPath"], {
    encoding: "utf8", timeout: 3000,
  }).stdout?.trim();
  return sameBinary === execPath ? onPath : execPath;
}

function install(extensionId: string): void {
  if (!existsSync(join(distDir, "main.js"))) {
    fail(`the connector is not built: ${join(distDir, "main.js")} is missing`);
  }

  // Chrome starts the wrapper with a minimal PATH, so it names node outright.
  const nodePath = stableNodePath();
  if (/\/v?\d+\.\d+\.\d+\//.test(nodePath)) {
    warn(`${nodePath} has a version in its path.`);
    warn("Upgrading node will move it and the connector will stop working.");
    warn("Run this again after upgrading, or install node somewhere stable.");
  }

  if (claudeAdapter.detect() === null) {
    warn("the claude CLI was not found. Install it and sign in, or the extension");
    warn("will have nothing to talk to.");
  }

  // Cleared first: copying over the top leaves modules from an older build
  // behind, and a stale file is indistinguishable from a current one.
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(RUN_DIR, { recursive: true });
  cpSync(distDir, RUN_DIR, { recursive: true });

  // The connector is ESM. Node 23 and later infer that from the syntax; older
  // releases do not, and fail with a message about import statements.
  writeFileSync(join(RUN_DIR, "package.json"), '{ "type": "module" }\n');

  const wrapper = join(RUN_DIR, "run-connector.sh");
  writeFileSync(wrapper, [
    "#!/bin/bash",
    `echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) WRAPPER start pid=$$ ppid=$PPID" >> "${LOG_PATH}"`,
    `exec "${nodePath}" "${join(RUN_DIR, "main.js")}"`,
    "",
  ].join("\n"));
  chmodSync(wrapper, 0o755);

  mkdirSync(MANIFEST_DIR, { recursive: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({
    name: HOST_NAME,
    description: "SenseBridge native messaging host",
    path: wrapper,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }, null, 2)}\n`);

  console.log("installed");
  console.log(`  runtime:   ${wrapper}`);
  console.log(`  manifest:  ${MANIFEST_PATH}`);
  console.log(`  extension: ${extensionId}`);
  console.log(`  log:       ${LOG_PATH}`);
  console.log("");
  console.log("Chrome reads host manifests at startup: quit it fully (Cmd+Q) and reopen.");
}

function uninstall(): void {
  rmSync(MANIFEST_PATH, { force: true });
  rmSync(RUN_DIR, { recursive: true, force: true });
  console.log("removed the connector and its manifest.");
  console.log(`The log is left at ${LOG_PATH}; delete it yourself if you want it gone.`);
}

/** Answers the questions asked whenever this does not work. */
function doctor(): void {
  const cliPath = claudeAdapter.detect();
  const chromeRunning = spawnSync("/usr/bin/pgrep", ["-x", "Google Chrome"]).status === 0;

  const lines: Array<[string, string]> = [
    ["connector version", CONNECTOR_VERSION],
    ["node", `${process.version} at ${process.execPath}`],
    ["connector installed", existsSync(join(RUN_DIR, "main.js")) ? "yes" : "no"],
    ["manifest installed", existsSync(MANIFEST_PATH) ? MANIFEST_PATH : "no"],
    ["claude CLI", cliPath ?? "not found"],
    ["providers found", detectProviders([claudeDescriptor, ollamaDescriptor])
      .map(p => `${p.id} (${p.path})`).join(", ") || "none"],
    ["claude quarantined", cliPath ? String(isQuarantined(cliPath)) : "n/a"],
    ["Chrome running", chromeRunning ? "yes — restart it if you just installed" : "no"],
  ];
  for (const [label, value] of lines) console.log(`  ${label.padEnd(20)} ${value}`);

  if (!existsSync(MANIFEST_PATH)) {
    console.log("\nRun `sense-bridge install` to register the host with Chrome.");
  }
}

function warn(message: string): void { console.error(`warning: ${message}`); }

function fail(message: string): never {
  console.error(`sense-bridge: ${message}`);
  process.exit(1);
}

function usage(): void {
  console.log(`sense-bridge ${CONNECTOR_VERSION}

  sense-bridge install [extension-id]   register the host with Chrome
  sense-bridge uninstall                remove it again
  sense-bridge doctor                   report what is and is not in place
  sense-bridge --version                print the version

The extension id defaults to the one pinned in the published extension, so it is
needed only when loading a differently signed build unpacked.`);
}

export function main(argv: string[]): void {
  const [command, argument] = argv;
  switch (command) {
    case "install": install(argument ?? EXTENSION_ID); break;
    case "uninstall": uninstall(); break;
    case "doctor": doctor(); break;
    case "--version": case "-v": console.log(CONNECTOR_VERSION); break;
    case undefined: case "--help": case "-h": usage(); break;
    default: fail(`unknown command: ${command}`);
  }
}

// Only when run as a command. Importing this file — a test does — must not
// parse whatever arguments that process happened to be given.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main(process.argv.slice(2));
}
