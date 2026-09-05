import { describe, it, expect } from "vitest";
import { encodeMessage, MessageDecoder, MAX_INCOMING_BYTES } from "../src/framing.js";

const framed = (body: string): Buffer => {
  const bytes = Buffer.from(body, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([header, bytes]);
};

const claiming = (length: number): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(length, 0);
  return Buffer.concat([header, Buffer.from("x")]);
};

describe("encodeMessage", () => {
  it("writes a little-endian uint32 length header", () => {
    const buf = encodeMessage({ a: 1 });
    const body = Buffer.from(JSON.stringify({ a: 1 }), "utf8");
    expect(buf.readUInt32LE(0)).toBe(body.length);
    expect(buf.subarray(4)).toEqual(body);
  });
});

describe("MessageDecoder", () => {
  it("round-trips a single message", () => {
    const decoder = new MessageDecoder();
    expect(decoder.push(encodeMessage({ type: "diag", id: 1 })))
      .toEqual([{ ok: true, value: { type: "diag", id: 1 } }]);
  });

  it("reassembles a message split across chunks", () => {
    const decoder = new MessageDecoder();
    const full = encodeMessage({ hello: "world" });
    expect(decoder.push(full.subarray(0, 2))).toEqual([]);
    expect(decoder.push(full.subarray(2, 7))).toEqual([]);
    expect(decoder.push(full.subarray(7))).toEqual([{ ok: true, value: { hello: "world" } }]);
  });

  it("returns every message when several arrive in one chunk", () => {
    const decoder = new MessageDecoder();
    const chunk = Buffer.concat([
      encodeMessage({ n: 1 }), encodeMessage({ n: 2 }), encodeMessage({ n: 3 }),
    ]);
    expect(decoder.push(chunk).map(message => message.ok && message.value))
      .toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("handles multi-byte UTF-8 split mid-character", () => {
    const decoder = new MessageDecoder();
    const full = encodeMessage({ text: "Привет, мир" });
    const cut = full.length - 3;
    expect(decoder.push(full.subarray(0, cut))).toEqual([]);
    expect(decoder.push(full.subarray(cut)))
      .toEqual([{ ok: true, value: { text: "Привет, мир" } }]);
  });

  it("reports an unreadable frame instead of throwing", () => {
    // Throwing took the host down and left everything queued behind the bad
    // frame unanswered as well.
    const decoder = new MessageDecoder();
    const [message] = decoder.push(framed("{not json"));
    expect(message).toMatchObject({ ok: false, fatal: false });
  });

  it("carries on with the frames after an unreadable one", () => {
    const decoder = new MessageDecoder();
    const got = decoder.push(Buffer.concat([framed("{not json"), encodeMessage({ n: 7 })]));
    expect(got).toHaveLength(2);
    expect(got[1]).toEqual({ ok: true, value: { n: 7 } });
  });

  it("refuses a length no real message could have", () => {
    // There is no finding the next boundary once a length is wrong, so waiting
    // for the rest would mean waiting forever while the buffer grows.
    const decoder = new MessageDecoder();
    const [message] = decoder.push(claiming(MAX_INCOMING_BYTES + 1));
    expect(message).toMatchObject({ ok: false, fatal: true });
  });

  it("reads nothing more once the stream is out of step", () => {
    const decoder = new MessageDecoder();
    decoder.push(claiming(MAX_INCOMING_BYTES + 1));
    expect(decoder.push(encodeMessage({ n: 1 }))).toEqual([]);
  });

  it("accepts a message right at the ceiling", () => {
    const decoder = new MessageDecoder();
    const big = { text: "x".repeat(1_000_000) };
    expect(decoder.push(encodeMessage(big))).toEqual([{ ok: true, value: big }]);
  });
});
