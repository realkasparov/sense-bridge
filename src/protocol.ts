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

export function chunkResponse(id: number, payload: unknown, maxBytes = MAX_FRAME_BYTES): Buffer[] {
  const json = JSON.stringify(payload);
  // Reserve room for the envelope's own fields plus the 4-byte length header.
  const budget = Math.max(1, maxBytes - 200);
  const bodies: string[] = [];
  for (let i = 0; i < json.length; i += budget) bodies.push(json.slice(i, i + budget));
  if (bodies.length === 0) bodies.push("");
  return bodies.map((body, chunkIndex) =>
    encodeMessage({ id, chunkIndex, chunkCount: bodies.length, body }));
}
