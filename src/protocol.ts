import { encodeMessage } from "./framing.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface Segment { id: string; text: string }

export interface TranslateRequest {
  type: "translate";
  id: number;
  targetLanguage: string;
  mode: "full" | "summary";
  model: string;
  effort: Effort;
  budgetUsd: number;
  styleRules: string;
  glossary: Record<string, string>;
  segments: Segment[];
}

export interface DiagRequest { type: "diag"; id: number }
export type HostRequest = TranslateRequest | DiagRequest;

export type ParseResult =
  | { ok: true; value: HostRequest }
  | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseRequest(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, error: "message is not an object" };
  if (typeof raw.id !== "number") return { ok: false, error: "missing numeric id" };

  if (raw.type === "diag") return { ok: true, value: { type: "diag", id: raw.id } };
  if (raw.type !== "translate") return { ok: false, error: `unknown message type: ${String(raw.type)}` };

  if (typeof raw.targetLanguage !== "string" || raw.targetLanguage === "")
    return { ok: false, error: "targetLanguage must be a non-empty string" };
  if (raw.mode !== "full" && raw.mode !== "summary")
    return { ok: false, error: `mode must be "full" or "summary"` };
  if (typeof raw.model !== "string" || raw.model === "")
    return { ok: false, error: "model must be a non-empty string" };
  if (!EFFORTS.includes(raw.effort as Effort))
    return { ok: false, error: `effort must be one of ${EFFORTS.join(", ")}` };
  if (typeof raw.budgetUsd !== "number" || !(raw.budgetUsd > 0))
    return { ok: false, error: "budgetUsd must be a positive number" };
  if (typeof raw.styleRules !== "string")
    return { ok: false, error: "styleRules must be a string" };
  if (!isRecord(raw.glossary))
    return { ok: false, error: "glossary must be an object" };
  if (!Array.isArray(raw.segments) || raw.segments.length === 0)
    return { ok: false, error: "segments must be a non-empty array" };

  const seen = new Set<string>();
  const segments: Segment[] = [];
  for (const s of raw.segments) {
    if (!isRecord(s) || typeof s.id !== "string" || typeof s.text !== "string")
      return { ok: false, error: "each segment needs a string id and string text" };
    if (seen.has(s.id)) return { ok: false, error: `duplicate segment id: ${s.id}` };
    seen.add(s.id);
    segments.push({ id: s.id, text: s.text });
  }

  return {
    ok: true,
    value: {
      type: "translate", id: raw.id, targetLanguage: raw.targetLanguage, mode: raw.mode,
      model: raw.model, effort: raw.effort as Effort, budgetUsd: raw.budgetUsd,
      styleRules: raw.styleRules, glossary: raw.glossary as Record<string, string>, segments,
    },
  };
}

/** Chrome rejects host to extension messages above 1 MB, so large payloads ship in frames. */
export const MAX_FRAME_BYTES = 900_000;

/**
 * Chrome's cap is in bytes, and a translation is mostly non-Latin text: Cyrillic
 * costs two bytes per character and emoji four, so a character-count budget
 * overshoots by half again. Each chunk is therefore sized by measuring the
 * encoded frame rather than counting characters.
 */
export function chunkResponse(id: number, payload: unknown, maxBytes = MAX_FRAME_BYTES): Buffer[] {
  const json = JSON.stringify(payload);

  // Measure against placeholder counters wider than any real ones, so the
  // frames built below can only come out smaller than what was measured.
  const frameSize = (body: string) =>
    encodeMessage({ id, chunkIndex: 999_999, chunkCount: 999_999, body }).length;

  if (frameSize("") > maxBytes) {
    throw new RangeError(`maxBytes ${maxBytes} is too small to hold a frame envelope`);
  }

  const bodies: string[] = [];
  let from = 0;
  while (from < json.length) {
    // Largest slice whose encoded frame still fits.
    let lo = 1, hi = json.length - from, take = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (frameSize(json.slice(from, from + mid)) <= maxBytes) { take = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    bodies.push(json.slice(from, from + take));
    from += take;
  }
  if (bodies.length === 0) bodies.push("");

  return bodies.map((body, chunkIndex) =>
    encodeMessage({ id, chunkIndex, chunkCount: bodies.length, body }));
}
