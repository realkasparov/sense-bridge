import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encodeMessage, MessageDecoder } from "../src/framing.js";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

function ask(message: unknown, env: Record<string, string> = {}): Promise<any[]> {
  return new Promise(resolve => {
    const child = spawn("npx", ["tsx", MAIN], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SENSEBRIDGE_CLI_PATH: FAKE, SENSEBRIDGE_FAKE_ARGS: "1",
             FAKE_MODE: "ok", ...env },
    });
    const dec = new MessageDecoder();
    const got: any[] = [];
    child.stdout.on("data", c => {
      for (const message of dec.push(c)) if (message.ok) got.push(message.value);
      if (got.length) { child.kill(); resolve(got); }
    });
    child.stdin.write(encodeMessage(message));
    setTimeout(() => { child.kill(); resolve(got); }, 15_000);
  });
}

describe("host entry point", () => {
  it("answers a diag request with environment details", async () => {
    const [res] = await ask({ type: "diag", id: 1 });
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.diag).toHaveProperty("PATH");
    expect(body.diag).toHaveProperty("cliPath");
  });

  it("answers a translate request through the fake CLI", async () => {
    const [res] = await ask({
      type: "translate", id: 2, targetLanguage: "ru", mode: "full", model: "sonnet",
      effort: "low", budgetUsd: 1, styleRules: "rules", glossary: {},
      segments: [{ id: "s1", text: "Hello" }],
    });
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.result).toContain("привет");
  });

  it("rejects a malformed request without dying", async () => {
    const [res] = await ask({ type: "translate", id: 3, segments: [] });
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.stage).toBe("validation");
  });
});
