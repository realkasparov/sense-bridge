/** Chrome native messaging framing: uint32LE byte length followed by UTF-8 JSON. */
export function encodeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export type DecodedMessage =
  | { ok: true; value: unknown }
  | { ok: false; error: string; fatal: boolean };

/**
 * Nothing larger than this can be a real request, so a length beyond it means
 * the stream is out of step rather than that a huge message is coming. Waiting
 * for one would mean waiting forever while the buffer grows.
 */
export const MAX_INCOMING_BYTES = 64 * 1024 * 1024;

/** Accumulates stdin chunks and yields whole messages as they complete. */
export class MessageDecoder {
  #buf: Buffer = Buffer.alloc(0);
  #broken = false;

  push(chunk: Buffer): DecodedMessage[] {
    if (this.#broken) return [];
    this.#buf = Buffer.concat([this.#buf, chunk]);

    const out: DecodedMessage[] = [];
    for (;;) {
      if (this.#buf.length < 4) break;

      const len = this.#buf.readUInt32LE(0);
      if (len > MAX_INCOMING_BYTES) {
        // There is no way to find the next frame boundary once a length is
        // wrong, so the stream is abandoned rather than guessed at.
        this.#broken = true;
        this.#buf = Buffer.alloc(0);
        out.push({ ok: false, fatal: true, error: `frame claims ${len} bytes; the stream is out of step` });
        break;
      }

      if (this.#buf.length < 4 + len) break;
      const body = this.#buf.subarray(4, 4 + len).toString("utf8");
      this.#buf = this.#buf.subarray(4 + len);

      try {
        out.push({ ok: true, value: JSON.parse(body) });
      } catch (error) {
        // One unreadable frame is answered and stepped over. Throwing here took
        // the host down and left everything queued behind it unanswered too.
        out.push({ ok: false, fatal: false, error: `frame is not JSON: ${String(error)}` });
      }
    }
    return out;
  }
}
