import { describe, it, expect } from "vitest";
import { encodeMessage, MessageDecoder } from "../src/framing.js";

describe("framing", () => {
  it("round-trips a single message", () => {
    const d = new MessageDecoder();
    expect(d.push(encodeMessage({ type: "diag", id: 1 }))).toEqual([{ type: "diag", id: 1 }]);
  });

  it("writes a little-endian uint32 length header", () => {
    const buf = encodeMessage({ a: 1 });
    const body = Buffer.from(JSON.stringify({ a: 1 }), "utf8");
    expect(buf.readUInt32LE(0)).toBe(body.length);
    expect(buf.subarray(4)).toEqual(body);
  });

  it("reassembles a message split across chunks", () => {
    const d = new MessageDecoder();
    const full = encodeMessage({ hello: "world" });
    expect(d.push(full.subarray(0, 2))).toEqual([]);
    expect(d.push(full.subarray(2, 7))).toEqual([]);
    expect(d.push(full.subarray(7))).toEqual([{ hello: "world" }]);
  });

  it("returns every message when several arrive in one chunk", () => {
    const d = new MessageDecoder();
    const chunk = Buffer.concat([encodeMessage({ n: 1 }), encodeMessage({ n: 2 }), encodeMessage({ n: 3 })]);
    expect(d.push(chunk)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("handles multi-byte UTF-8 split mid-character", () => {
    const d = new MessageDecoder();
    const full = encodeMessage({ text: "Привет, мир" });
    const cut = full.length - 3;
    expect(d.push(full.subarray(0, cut))).toEqual([]);
    expect(d.push(full.subarray(cut))).toEqual([{ text: "Привет, мир" }]);
  });
});
