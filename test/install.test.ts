import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../install/install.sh", import.meta.url));
const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "sb-home-"));
  const dist = fileURLToPath(new URL("../../dist/host", import.meta.url));
  mkdirSync(dist, { recursive: true });
  if (!existsSync(join(dist, "main.js"))) writeFileSync(join(dist, "main.js"), "// placeholder\n");
  execFileSync("bash", [SCRIPT, EXT_ID], { env: { ...process.env, HOME: home } });
});

describe("install.sh", () => {
  const manifestPath = () => join(home,
    "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sense-bridge.host.json");

  it("writes the native messaging manifest", () => {
    expect(existsSync(manifestPath())).toBe(true);
  });

  it("allows only the given extension id", () => {
    const m = JSON.parse(readFileSync(manifestPath(), "utf8"));
    expect(m.allowed_origins).toEqual([`chrome-extension://${EXT_ID}/`]);
    expect(m.type).toBe("stdio");
  });

  it("installs the runtime outside ~/Documents", () => {
    const m = JSON.parse(readFileSync(manifestPath(), "utf8"));
    expect(m.path).toContain("Library/Application Support/SenseBridge");
    expect(m.path).not.toContain("/Documents/");
    expect(existsSync(m.path)).toBe(true);
  });

  it("hardcodes an absolute node path in the wrapper", () => {
    const m = JSON.parse(readFileSync(manifestPath(), "utf8"));
    const wrapper = readFileSync(m.path, "utf8");
    expect(wrapper).toMatch(/exec "\/.*node"/);
  });

  it("refuses to run without an extension id", () => {
    expect(() => execFileSync("bash", [SCRIPT], { env: { ...process.env, HOME: home } })).toThrow();
  });
});
