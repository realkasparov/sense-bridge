import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { runOllama } from "../src/providers/ollama.js";
import type { TranslateRequest, ImageRequest } from "../src/protocol.js";

let server: Server | null = null;
afterEach(() => { server?.close(); server = null; });

/** A stand-in for the daemon: records what it was asked and answers as told. */
function fakeOllama(reply: (body: any) => { status?: number; json?: unknown; raw?: string; delayMs?: number }) {
  const seen: any[] = [];
  server = createServer((req, res) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => {
      const body = JSON.parse(data);
      seen.push({ url: req.url, body });
      const r = reply(body);
      setTimeout(() => {
        res.statusCode = r.status ?? 200;
        res.setHeader("content-type", "application/json");
        res.end(r.raw ?? JSON.stringify(r.json));
      }, r.delayMs ?? 0);
    });
  });
  return new Promise<{ base: string; seen: any[] }>(resolve => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as { port: number };
      resolve({ base: `http://127.0.0.1:${port}`, seen });
    });
  });
}

const translate: TranslateRequest = {
  provider: "ollama", type: "translate", id: 1, targetLanguage: "Russian", mode: "full",
  model: "llama3.2:latest", effort: "low", budgetUsd: 1, styleRules: "Plain.",
  glossary: {}, segments: [{ id: "a", text: "Hello" }],
};

describe("runOllama", () => {
  it("sends the kernel prompt as the system role and the page as the user role", async () => {
    // The trust boundary is structural here, as it is with claude: instructions
    // and page content travel in different roles, never in one string.
    const { base, seen } = await fakeOllama(() => ({
      json: { message: { content: '{"segments":[{"id":"a","text":"Привет"}]}' },
              prompt_eval_count: 40, eval_count: 9, done: true },
    }));
    const r = await runOllama(translate, { base });
    expect(r.ok).toBe(true);
    expect(r.outcome?.text).toBe('{"segments":[{"id":"a","text":"Привет"}]}');

    const [call] = seen;
    expect(call.url).toBe("/api/chat");
    expect(call.body.model).toBe("llama3.2:latest");
    expect(call.body.stream).toBe(false);
    expect(call.body.format).toBe("json");
    const [system, user] = call.body.messages;
    expect(system.role).toBe("system");
    expect(system.content).toContain("TRUST BOUNDARY");
    expect(user.role).toBe("user");
    expect(JSON.parse(user.content)).toMatchObject({ targetLanguage: "Russian", segments: [{ id: "a", text: "Hello" }] });
    // Page text must not have leaked into the system prompt.
    expect(system.content).not.toContain("Hello");
  });

  it("reports token counts and a zero cost", async () => {
    // Local inference has no bill; saying so explicitly keeps the usage page
    // from showing a made-up dollar figure.
    const { base } = await fakeOllama(() => ({
      json: { message: { content: "{}" }, prompt_eval_count: 40, eval_count: 9, done: true },
    }));
    const r = await runOllama(translate, { base });
    expect(r.outcome?.usage).toEqual({ input_tokens: 40, output_tokens: 9 });
    expect(r.outcome?.costUsd).toBe(0);
  });

  it("fails cleanly when the daemon is not running", async () => {
    const r = await runOllama(translate, { base: "http://127.0.0.1:1" });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("spawn");
    expect(r.error).toMatch(/ollama/i);
  });

  it("surfaces the daemon's own error text", async () => {
    // "model not found" is the message that matters; burying it under a
    // generic HTTP 404 would send the user looking in the wrong place.
    const { base } = await fakeOllama(() => ({ status: 404, json: { error: "model 'nope' not found" } }));
    const r = await runOllama({ ...translate, model: "nope" }, { base });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("model 'nope' not found");
    expect(r.outcome?.apiErrorStatus).toBe(404);
  });

  it("gives up after the timeout instead of hanging", async () => {
    const { base } = await fakeOllama(() => ({ json: { message: { content: "{}" } }, delayMs: 500 }));
    const r = await runOllama(translate, { base, timeoutMs: 50 });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("timeout");
  });

  it("attaches an image to the user message for image requests", async () => {
    const { base, seen } = await fakeOllama(() => ({ json: { message: { content: '{"regions":[]}' } } }));
    const image: ImageRequest = {
      provider: "ollama", type: "image", id: 2, targetLanguage: "Russian", model: "llava", effort: "low",
      budgetUsd: 1, mediaType: "image/png", dataBase64: "AAAA", width: 10, height: 10,
    };
    const r = await runOllama(image, { base });
    expect(r.ok).toBe(true);
    const [, user] = seen[0].body.messages;
    expect(user.images).toEqual(["AAAA"]);
  });
});
