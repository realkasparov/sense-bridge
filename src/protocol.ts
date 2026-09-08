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
  /** Produced by a context request; empty when whole-page context is off. */
  contextBrief?: string;
  segments: Segment[];
}

/**
 * The first pass of whole-page context mode: one cheap request that returns a
 * brief and a glossary rather than a translation, which every later batch then
 * carries. Sending the page itself with each batch would make cost grow with
 * the square of the batch count — measured, and rejected, on the bridge.
 */
export interface ContextRequest {
  type: "context";
  id: number;
  targetLanguage: string;
  model: string;
  effort: Effort;
  budgetUsd: number;
  title: string;
  digest: string;
}

/** Reading an image: the model returns legible text with boxes, never a new image. */
export interface ImageRequest {
  type: "image";
  id: number;
  targetLanguage: string;
  model: string;
  effort: Effort;
  budgetUsd: number;
  mediaType: string;
  dataBase64: string;
  /** Pixel size of what was sent, so the model can reason about proportions. */
  width?: number;
  height?: number;
}

export interface DiagRequest { type: "diag"; id: number }
export type WorkRequest = TranslateRequest | ContextRequest | ImageRequest;
export type HostRequest = WorkRequest | DiagRequest;

export type ParseResult =
  | { ok: true; value: HostRequest }
  | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseRequest(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, error: "message is not an object" };
  if (typeof raw.id !== "number") return { ok: false, error: "missing numeric id" };

  if (raw.type === "diag") return { ok: true, value: { type: "diag", id: raw.id } };

  if (raw.type === "context") {
    if (typeof raw.targetLanguage !== "string" || raw.targetLanguage === "")
      return { ok: false, error: "targetLanguage must be a non-empty string" };
    if (typeof raw.model !== "string" || raw.model === "")
      return { ok: false, error: "model must be a non-empty string" };
    if (!EFFORTS.includes(raw.effort as Effort))
      return { ok: false, error: `effort must be one of ${EFFORTS.join(", ")}` };
    if (typeof raw.budgetUsd !== "number" || !(raw.budgetUsd > 0))
      return { ok: false, error: "budgetUsd must be a positive number" };
    if (typeof raw.digest !== "string" || raw.digest.trim() === "")
      return { ok: false, error: "digest must be a non-empty string" };
    return { ok: true, value: {
      type: "context", id: raw.id, targetLanguage: raw.targetLanguage, model: raw.model,
      effort: raw.effort as Effort, budgetUsd: raw.budgetUsd,
      title: typeof raw.title === "string" ? raw.title : "", digest: raw.digest,
    }};
  }

  if (raw.type === "image") {
    if (typeof raw.targetLanguage !== "string" || raw.targetLanguage === "")
      return { ok: false, error: "targetLanguage must be a non-empty string" };
    if (typeof raw.model !== "string" || raw.model === "")
      return { ok: false, error: "model must be a non-empty string" };
    if (!EFFORTS.includes(raw.effort as Effort))
      return { ok: false, error: `effort must be one of ${EFFORTS.join(", ")}` };
    if (typeof raw.budgetUsd !== "number" || !(raw.budgetUsd > 0))
      return { ok: false, error: "budgetUsd must be a positive number" };
    if (typeof raw.mediaType !== "string" || !raw.mediaType.startsWith("image/"))
      return { ok: false, error: "mediaType must name an image type" };
    if (typeof raw.dataBase64 !== "string" || raw.dataBase64 === "")
      return { ok: false, error: "dataBase64 must be a non-empty string" };
    return { ok: true, value: {
      type: "image", id: raw.id, targetLanguage: raw.targetLanguage, model: raw.model,
      effort: raw.effort as Effort, budgetUsd: raw.budgetUsd,
      mediaType: raw.mediaType, dataBase64: raw.dataBase64,
      width: typeof raw.width === "number" ? raw.width : undefined,
      height: typeof raw.height === "number" ? raw.height : undefined,
    }};
  }

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
  for (const candidate of raw.segments) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.text !== "string")
      return { ok: false, error: "each segment needs a string id and string text" };
    if (seen.has(candidate.id)) return { ok: false, error: `duplicate segment id: ${candidate.id}` };
    seen.add(candidate.id);
    segments.push({ id: candidate.id, text: candidate.text });
  }

  return {
    ok: true,
    value: {
      type: "translate", id: raw.id, targetLanguage: raw.targetLanguage, mode: raw.mode,
      model: raw.model, effort: raw.effort as Effort, budgetUsd: raw.budgetUsd,
      styleRules: raw.styleRules, glossary: raw.glossary as Record<string, string>,
      contextBrief: typeof raw.contextBrief === "string" ? raw.contextBrief : undefined,
      segments,
    },
  };
}

/** Chrome rejects connector to extension messages above 1 MB, so large payloads ship in frames. */
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
