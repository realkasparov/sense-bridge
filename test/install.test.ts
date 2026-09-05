import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
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

  it("declares ESM explicitly instead of relying on the node version", () => {
    const pkg = join(home, "Library/Application Support/SenseBridge/package.json");
    expect(existsSync(pkg)).toBe(true);
    expect(JSON.parse(readFileSync(pkg, "utf8")).type).toBe("module");
  });

  it("answers a framed request when run from its installed location", async () => {
    // The suite otherwise exercises the repo tree; Chrome runs this copy.
    const m = JSON.parse(readFileSync(manifestPath(), "utf8"));
    const child = spawn("bash", [m.path], {
      stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, HOME: home },
    });
    const body = Buffer.from(JSON.stringify({ type: "diag", id: 1 }), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);

    const answer = await new Promise<Record<string, unknown>>((resolve, reject) => {
      let out = Buffer.alloc(0);
      let err = "";
      child.stdout.on("data", c => {
        out = Buffer.concat([out, c]);
        if (out.length >= 4 && out.length >= 4 + out.readUInt32LE(0)) {
          const frame = JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString("utf8"));
          child.kill();
          resolve(JSON.parse(frame.body));
        }
      });
      child.stderr.on("data", c => { err += c; });
      child.on("close", () => reject(new Error(`installed host produced no answer: ${err}`)));
      child.stdin.write(Buffer.concat([header, body]));
      setTimeout(() => { child.kill(); reject(new Error("installed host timed out")); }, 10_000);
    });

    expect(answer.ok).toBe(true);
  }, 15_000);

  it("installs for the pinned extension id when none is given", () => {
    const home2 = mkdtempSync(join(tmpdir(), "sb-home-"));
    execFileSync("bash", [SCRIPT], { env: { ...process.env, HOME: home2 } });
    const m = JSON.parse(readFileSync(join(home2,
      "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sense-bridge.host.json"), "utf8"));
    expect(m.allowed_origins[0]).toMatch(/^chrome-extension:\/\/[a-p]{32}\/$/);
  });
});
