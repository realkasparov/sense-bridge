#!/usr/bin/env node
// A stand-in for a provider CLI. FAKE_MODE selects the behaviour under test.
// It mimics the real contract: read stream-json on stdin, emit result lines on stdout.
import { createInterface } from "node:readline";

const mode = process.env.FAKE_MODE ?? "ok";
const emit = o => process.stdout.write(JSON.stringify(o) + "\n");

if (mode === "spawn-fail") process.exit(3);
if (mode === "silent-exit") process.exit(0);
// A real CLI holding an open stream-json session stays alive after stdin closes.
// Without this the "hang" fixture would exit and exercise the wrong branch.
if (mode === "hang") setInterval(() => {}, 1 << 30);

createInterface({ input: process.stdin }).on("line", () => {
  if (mode === "hang") return;                       // never answers
  if (mode === "rate-limited") {
    emit({ type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "rate limited" });
  } else if (mode === "garbage") {
    process.stdout.write("this is not json\n");
    emit({ type: "assistant", message: { content: [] } });
    emit({ type: "result", subtype: "success", is_error: false, api_error_status: null,
           result: '{"segments":[{"id":"s1","text":"ок"}]}', usage: { input_tokens: 11 } });
  } else {
    emit({ type: "assistant", message: { content: [{ type: "text", text: "ignored" }] } });
    emit({ type: "result", subtype: "success", is_error: false, api_error_status: null,
           result: '{"segments":[{"id":"s1","text":"привет"}]}', usage: { input_tokens: 42 } });
  }
});
