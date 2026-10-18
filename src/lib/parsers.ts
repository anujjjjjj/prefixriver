// Capture parsers: turn raw JSON / JSONL / HAR text into NormalizedRequest[].

import { approxTokens, collectCacheControls, hasCacheControl, stableStringify } from "./canonical";
import type { NormalizedRequest, Provider, Segment, SegmentKind } from "./types";

export class CaptureParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureParseError";
  }
}

export type CaptureFormat = "json" | "json-array" | "jsonl" | "har";

export interface ParsedCapture {
  requests: NormalizedRequest[];
  /** Lines / entries / array items that could not be turned into a request. */
  skipped: number;
  format: CaptureFormat;
}

type Obj = Record<string, unknown>;
type Usage = NonNullable<NormalizedRequest["usage"]>;

interface RequestMeta {
  timestamp?: number;
  url?: string;
  anthropicHeader?: boolean;
  usage?: Usage;
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- timestamps

function parseTimestamp(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? Math.round(v * 1000) : v;
  if (typeof v !== "string" || !v.trim()) return undefined;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return parseTimestamp(Number(v));
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

// --------------------------------------------------------------------- usage

function extractUsage(u: unknown): Usage | undefined {
  if (!isObj(u)) return undefined;
  const out: Usage = {};
  const anthropicStyle = "cache_read_input_tokens" in u || "cache_creation_input_tokens" in u;
  // Anthropic: input_tokens excludes cached tokens. OpenAI: prompt_tokens / input_tokens is the total.
  out.inputTokens = num(u.prompt_tokens) ?? num(u.input_tokens);
  out.outputTokens = num(u.completion_tokens) ?? num(u.output_tokens);
  if (anthropicStyle) {
    out.cacheReadTokens = num(u.cache_read_input_tokens);
    out.cacheWriteTokens = num(u.cache_creation_input_tokens);
  } else {
    const details = isObj(u.prompt_tokens_details) ? u.prompt_tokens_details : isObj(u.input_tokens_details) ? u.input_tokens_details : undefined;
    out.cacheReadTokens = num(details?.cached_tokens);
  }
  for (const k of Object.keys(out) as (keyof Usage)[]) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

function usageFromBody(body: unknown): Usage | undefined {
  if (!isObj(body)) return undefined;
  return extractUsage(body.usage) ?? extractUsage(isObj(body.message) ? body.message.usage : undefined) ?? extractUsage(isObj(body.response) ? body.response.usage : undefined);
}

/** Usage from a response payload: JSON body, or an SSE stream whose events carry usage. */
function usageFromResponseText(text: string): Usage | undefined {
  const direct = usageFromBody(tryParse(text));
  if (direct) return direct;
  let merged: Usage | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const u = usageFromBody(tryParse(line.slice(5).trim()));
    if (u) merged = { ...merged, ...u };
  }
  return merged;
}

function usageFromResponse(resp: unknown): Usage | undefined {
  if (!isObj(resp)) return undefined;
  const direct = usageFromBody(resp) ?? usageFromBody(resp.body);
  if (direct) return direct;
  if (typeof resp.body === "string") return usageFromResponseText(resp.body);
  if (isObj(resp.content) && typeof resp.content.text === "string") {
    let text = resp.content.text;
    if (resp.content.encoding === "base64") {
      try {
        text = atob(text);
      } catch {
        return undefined;
      }
    }
    return usageFromResponseText(text);
  }
  return undefined;
}

// -------------------------------------------------------------- segmentation

const SYSTEM_ROLES = new Set(["system", "developer"]);

function makeSegment(kind: SegmentKind, label: string, value: unknown, forceMarker = false): Segment {
  const text = stableStringify(value);
  return { kind, label, text, tokens: approxTokens(text), cacheMarker: forceMarker || hasCacheControl(value) };
}

function toolName(tool: unknown, i: number): string {
  if (isObj(tool)) {
    if (typeof tool.name === "string") return tool.name;
    if (isObj(tool.function) && typeof tool.function.name === "string") return tool.function.name;
    if (typeof tool.type === "string") return tool.type;
  }
  return String(i);
}

function messageRole(m: unknown): string {
  if (isObj(m)) {
    if (typeof m.role === "string") return m.role;
    if (typeof m.type === "string") return m.type;
  }
  return "item";
}

function buildSegments(body: Obj): Segment[] {
  const segs: Segment[] = [];
  if (Array.isArray(body.tools)) {
    body.tools.forEach((t, i) => segs.push(makeSegment("tools", `tools[${i}] ${toolName(t, i)}`, t)));
  }
  let sysCount = 0;
  const sysLabel = () => (sysCount++ === 0 ? "system" : `system[${sysCount - 1}]`);

  if (typeof body.system === "string") {
    segs.push(makeSegment("system", "system", body.system));
  } else if (Array.isArray(body.system)) {
    body.system.forEach((b, i) => segs.push(makeSegment("system", `system[${i}]`, b)));
  }
  if (typeof body.instructions === "string") segs.push(makeSegment("system", sysLabel(), body.instructions));

  const items: unknown[] = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : typeof body.input === "string"
        ? [{ role: "user", content: body.input }]
        : [];
  items.forEach((m, i) => {
    const role = messageRole(m);
    if (isObj(m) && typeof m.role === "string" && SYSTEM_ROLES.has(role)) {
      segs.push(makeSegment("system", sysLabel(), m));
    } else {
      segs.push(makeSegment("message", `messages[${i}] ${role}`, m));
    }
  });
  return segs;
}

function detectProvider(body: Obj, meta: RequestMeta): Provider {
  const url = meta.url ?? "";
  if (/anthropic/i.test(url) || /\/v1\/messages/.test(url) || meta.anthropicHeader) return "anthropic";
  if (/openai|\/chat\/completions|\/v1\/responses/i.test(url)) return "openai";
  if ("system" in body && body.system !== undefined) return "anthropic";
  if (Array.isArray(body.tools) && body.tools.some((t) => isObj(t) && "input_schema" in t)) return "anthropic";
  if (hasCacheControl(body.messages) || hasCacheControl(body.tools)) return "anthropic";
  if (typeof body.model === "string" && /^claude/i.test(body.model)) return "anthropic";
  return "openai";
}

function isRequestBody(v: unknown): boolean {
  return isObj(v) && (Array.isArray(v.messages) || Array.isArray(v.input) || typeof v.input === "string");
}

function buildRequest(body: Obj, index: number, meta: RequestMeta): NormalizedRequest {
  const segments = buildSegments(body);
  const provider = detectProvider(body, meta);
  const ttls = collectCacheControls([body.tools, body.system, body.messages]).map((c) => c.ttl);
  const req: NormalizedRequest = {
    index,
    provider,
    model: typeof body.model === "string" ? body.model : "unknown",
    segments,
    totalTokens: segments.reduce((a, s) => a + s.tokens, 0),
    ttlSeconds: ttls.includes("1h") ? 3600 : 300,
  };
  if (meta.timestamp !== undefined) req.timestamp = meta.timestamp;
  if (meta.usage) req.usage = meta.usage;
  return req;
}

// ----------------------------------------------------------------- raw items

const TIME_KEYS = ["timestamp", "ts", "time"] as const;

/** Accepts a raw request or a {timestamp, request|body, response?} wrapper. */
function fromRawItem(item: unknown, index: number): NormalizedRequest | undefined {
  if (!isObj(item)) return undefined;
  if (isRequestBody(item)) return buildRequest(item, index, {});

  let inner: unknown = item.request ?? item.body;
  if (typeof inner === "string") inner = tryParse(inner);
  if (isObj(inner) && !isRequestBody(inner) && inner.body !== undefined) {
    inner = typeof inner.body === "string" ? tryParse(inner.body) : inner.body;
  }
  if (!isObj(inner) || !isRequestBody(inner)) return undefined;

  let timestamp: number | undefined;
  for (const k of TIME_KEYS) {
    timestamp = parseTimestamp(item[k]);
    if (timestamp !== undefined) break;
  }
  const url = typeof item.url === "string" ? item.url : isObj(item.request) && typeof item.request.url === "string" ? item.request.url : undefined;
  return buildRequest(inner, index, { timestamp, url, usage: usageFromResponse(item.response) });
}

// ----------------------------------------------------------------------- HAR

const LLM_URL = /\/v1\/messages|\/chat\/completions|\/v1\/responses/;

function fromHarEntry(entry: unknown, index: number): NormalizedRequest | undefined {
  if (!isObj(entry) || !isObj(entry.request)) return undefined;
  const req = entry.request;
  if (typeof req.method === "string" && req.method.toUpperCase() !== "POST") return undefined;
  const url = typeof req.url === "string" ? req.url : "";
  const text = isObj(req.postData) && typeof req.postData.text === "string" ? req.postData.text : undefined;
  if (!text) return undefined;
  const body = tryParse(text);
  if (!isObj(body) || !isRequestBody(body)) return undefined;
  if (!LLM_URL.test(url) && typeof body.model !== "string") return undefined;
  const anthropicHeader = Array.isArray(req.headers) && req.headers.some((h) => isObj(h) && typeof h.name === "string" && h.name.toLowerCase() === "anthropic-version");
  return buildRequest(body, index, { url, anthropicHeader, timestamp: parseTimestamp(entry.startedDateTime), usage: usageFromResponse(entry.response) });
}

// ---------------------------------------------------------------------- main

function collect(items: unknown[], fn: (item: unknown, index: number) => NormalizedRequest | undefined): { requests: NormalizedRequest[]; skipped: number } {
  const requests: NormalizedRequest[] = [];
  let skipped = 0;
  for (const item of items) {
    const r = fn(item, requests.length);
    if (r) requests.push(r);
    else skipped++;
  }
  return { requests, skipped };
}

export function parseCaptureDetailed(text: string): ParsedCapture {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) throw new CaptureParseError("Capture is empty. Paste a request, JSON array, JSONL or HAR file.");

  const whole = tryParse(trimmed);
  if (whole !== undefined) {
    if (isObj(whole) && isObj(whole.log) && Array.isArray(whole.log.entries)) {
      const { requests, skipped } = collect(whole.log.entries, fromHarEntry);
      if (!requests.length) throw new CaptureParseError("HAR contained no LLM requests (looked for /v1/messages, /chat/completions, /v1/responses or POST bodies with model + messages/input).");
      return { requests, skipped, format: "har" };
    }
    if (Array.isArray(whole)) {
      const { requests, skipped } = collect(whole, fromRawItem);
      if (!requests.length) throw new CaptureParseError("JSON array contained no recognizable LLM requests.");
      return { requests, skipped, format: "json-array" };
    }
    const single = fromRawItem(whole, 0);
    if (!single) throw new CaptureParseError("JSON is not a recognizable LLM request: expected an object with `messages` or `input`.");
    return { requests: [single], skipped: 0, format: "json" };
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  const { requests, skipped } = collect(
    lines.map((l) => tryParse(l)),
    fromRawItem,
  );
  if (!requests.length) {
    throw new CaptureParseError(`Could not parse input as JSON, JSONL or HAR: no line contained a recognizable LLM request (${lines.length} line(s) checked).`);
  }
  return { requests, skipped, format: "jsonl" };
}

export function parseCapture(text: string): NormalizedRequest[] {
  return parseCaptureDetailed(text).requests;
}
