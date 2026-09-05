/** Chrome native messaging framing: uint32LE byte length followed by UTF-8 JSON. */
export function encodeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Accumulates stdin chunks and yields whole messages as they complete. */
export class MessageDecoder {
  #buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const out: unknown[] = [];
    for (;;) {
      if (this.#buf.length < 4) break;
      const len = this.#buf.readUInt32LE(0);
      if (this.#buf.length < 4 + len) break;
      out.push(JSON.parse(this.#buf.subarray(4, 4 + len).toString("utf8")));
      this.#buf = this.#buf.subarray(4 + len);
    }
    return out;
  }
}
